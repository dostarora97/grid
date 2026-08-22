import { common, d, std, tgpu } from 'typegpu';
import { CameraStruct } from './camera';
import { attachInteractions, type CameraState } from './interactions';
import { log } from './logger';
import { projectAxis } from './projection';
import { attachInputTelemetry } from './telemetry';
import { CAMERA, COLORS, GRID, TAIL, TAIL_MODE } from './tunables';

const canvasEl = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvasEl) {
  throw new Error('#canvas element not found');
}
const canvas: HTMLCanvasElement = canvasEl;

const root = await tgpu.init();
const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });

log.boot.info('GPU ready', {
  preferredFormat: navigator.gpu.getPreferredCanvasFormat(),
  maxTextureDimension2D: root.device.limits.maxTextureDimension2D,
  features: [...root.device.features],
  limits: root.device.limits,
});
log.boot.debug('tunables', { GRID, COLORS, CAMERA, TAIL, tailMode: TAIL_MODE[TAIL] });

// CPU-side camera state — the whole per-frame upload (Architecture §7.1, §8.3).
const cam: CameraState = { focusX: 0, focusY: 0, zoom: CAMERA.defaultZoom };

declare global {
  interface Window {
    /** Live camera state, exposed for debugging/inspection. */
    gridCam: CameraState;
  }
}
if (typeof window !== 'undefined') {
  window.gridCam = cam;
}

const camera = root.createUniform(CameraStruct, {
  focus: d.vec2f(0, 0),
  zoom: cam.zoom,
  resolution: d.vec2f(1, 1),
  tailMode: TAIL_MODE[TAIL],
  focusMinorFrac: d.vec2f(0, 0),
  focusMajorFrac: d.vec2f(0, 0),
});

// Colors captured by the shader as GPU constants.
const BG = d.vec3f(COLORS.bgR, COLORS.bgG, COLORS.bgB);
const LINE = d.vec3f(1, 1, 1);

// Precomputed inverse cell spacings (float constants → f32 in the shader).
const INV_MINOR = 1 / GRID.spacing;
const INV_MAJOR = 1 / (GRID.spacing * GRID.major);

/**
 * Anti-aliased coverage of a gridline given the per-pixel distance to the
 * nearest line (in device px) and the line's half-width (px). 1 on the line,
 * fading to 0 one pixel past its edge (Architecture §7.5).
 */
function lineCoverage(distPx: number, halfPx: number): number {
  'use gpu';
  return d.f32(1) - std.smoothstep(d.f32(halfPx), d.f32(halfPx) + d.f32(1), distPx);
}

/**
 * Inverse Φ tail (screen→world), one axis, in normalized coords u ∈ (−1,1) → p
 * (where p = z·d/W). Branch is on the uniform `mode` — uniform control flow, so
 * the later fwidth stays valid: 0 = rational (u/(1−|u|)), 1 = tanh (atanh),
 * 2 = atan (tan). Mirrors TAILS in projection.ts (Architecture §7.7).
 */
function expandTail(u: number, mode: number): number {
  'use gpu';
  if (mode > 1.5) {
    return (2 / Math.PI) * std.tan((Math.PI / 2) * u);
  }
  if (mode > 0.5) {
    return 0.5 * std.log((1 + u) / (1 - u));
  }
  return u / (1 - std.abs(u));
}

const pipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: ({ uv }) => {
    'use gpu';
    const c = camera.$;

    // Screen offset from center, in device pixels. uv∈[0,1], center 0.5.
    // Flip Y so world-Y increases upward (math convention).
    const off = d.vec2f((uv.x - 0.5) * c.resolution.x, (0.5 - uv.y) * c.resolution.y);

    // Separable inverse projection Φ⁻¹ (Architecture §7.3, §7.7): recover the
    // world point under this pixel, per-axis. u = ox/Wx, v = oy/Wy (NDC-like,
    // clamped off the edge singularity); the selected tail expands them back to
    // world deltas. Near the edge the map → ∞ — correct: gridlines bunch
    // infinitely toward the frame edge (the signature of infinity).
    const half = c.resolution * 0.5;
    const ndc = std.clamp(off / half, d.vec2f(-0.999999, -0.999999), d.vec2f(0.999999, 0.999999));
    const p = d.vec2f(expandTail(ndc.x, c.tailMode), expandTail(ndc.y, c.tailMode));
    // `delta` is the world offset from the focus (small near the center). We keep
    // the grid phase *relative to the focus* — adding the CPU-computed fractional
    // cell offset — so fract() only sees small numbers and the lattice stays
    // crisp arbitrarily far from the origin (translation invariance).
    const delta = (p * half) / c.zoom;
    // `world` is the absolute coordinate, used only for the origin axes — precise
    // in f32 exactly when it matters (the origin is only in view when |focus| is
    // small); far from the origin the axes sit in the edge wash anyway.
    const world = c.focus + delta;

    // Analytic gridlines via screen-space derivatives (Architecture §7.5, §8.3):
    // fract of (relative cell offset + focus's fractional cell offset).
    const minorCell = delta * INV_MINOR + c.focusMinorFrac;
    const majorCell = delta * INV_MAJOR + c.focusMajorFrac;

    const minorD = std.abs(std.fract(minorCell - 0.5) - 0.5) / std.fwidth(minorCell);
    const majorD = std.abs(std.fract(majorCell - 0.5) - 0.5) / std.fwidth(majorCell);
    const axisD = std.abs(world) / std.fwidth(world);

    // Because the map is separable, screen-vertical lines come only from the
    // x-coordinate and horizontal lines only from y — combine with max.
    const minor = std.max(
      lineCoverage(minorD.x, GRID.minorHalfPx),
      lineCoverage(minorD.y, GRID.minorHalfPx),
    );
    const major = std.max(
      lineCoverage(majorD.x, GRID.majorHalfPx),
      lineCoverage(majorD.y, GRID.majorHalfPx),
    );
    const axis = std.max(
      lineCoverage(axisD.x, GRID.axisHalfPx),
      lineCoverage(axisD.y, GRID.axisHalfPx),
    );

    // Composite back-to-front: minor, then major over it, then the origin axes.
    const c1 = std.mix(BG, LINE, minor * COLORS.minorAlpha);
    const c2 = std.mix(c1, LINE, major * COLORS.majorAlpha);
    const c3 = std.mix(c2, LINE, axis * COLORS.axisAlpha);
    return d.vec4f(c3, 1);
  },
});

log.boot.info('render pipeline created — starting loop');

let dirty = true;

// Fractional offset of `v` within a cell of `spacing`, in f64 — the precise part
// the grid phase needs, with the huge integer magnitude discarded before it can
// reach the GPU's f32 (Architecture §8.3).
function cellFraction(v: number, spacing: number): number {
  const q = v / spacing;
  return q - Math.floor(q);
}

function writeCamera() {
  const minorSpacing = GRID.spacing;
  const majorSpacing = GRID.spacing * GRID.major;
  const minorFrac: [number, number] = [
    cellFraction(cam.focusX, minorSpacing),
    cellFraction(cam.focusY, minorSpacing),
  ];
  const majorFrac: [number, number] = [
    cellFraction(cam.focusX, majorSpacing),
    cellFraction(cam.focusY, majorSpacing),
  ];
  const snapshot = {
    focus: { x: cam.focusX, y: cam.focusY },
    zoom: cam.zoom,
    resolution: { w: canvas.width, h: canvas.height },
    tailMode: TAIL_MODE[TAIL],
    focusMinorFrac: minorFrac,
    focusMajorFrac: majorFrac,
  };
  log.camera.silly('write', snapshot);
  camera.write({
    focus: d.vec2f(cam.focusX, cam.focusY),
    zoom: cam.zoom,
    resolution: d.vec2f(canvas.width, canvas.height),
    tailMode: TAIL_MODE[TAIL],
    focusMinorFrac: d.vec2f(minorFrac[0], minorFrac[1]),
    focusMajorFrac: d.vec2f(majorFrac[0], majorFrac[1]),
  });
}

// Pan / zoom / focus-glide — all mutate `cam` and mark the frame dirty (§7.6).
const markDirty = () => {
  dirty = true;
};
const interactions = attachInteractions(canvas, cam, markDirty);
attachInputTelemetry(canvas);

let lastTime = performance.now();
let frameNo = 0;
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp long stalls
  lastTime = now;
  interactions.tick(dt); // advances the glide spring, marking dirty while moving
  if (dirty) {
    frameNo += 1;
    // Diagnostic: where does world-(0,0) project? Φ maps it strictly inside the
    // frame forever, so |originScreen| < half always (edgeGap > 0). If edgeGap
    // ever goes ≤ 0, the origin truly left the frame (a real bug). If it's a
    // tiny positive number, the origin is just squeezed into the edge (expected).
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;
    const originX = projectAxis(-cam.focusX, halfW, cam.zoom);
    const originY = projectAxis(-cam.focusY, halfH, cam.zoom);
    log.frame.silly('render', {
      frame: frameNo,
      dtMs: +(dt * 1000).toFixed(2),
      cam: { focusX: cam.focusX, focusY: cam.focusY, zoom: cam.zoom },
      focusMag: Math.hypot(cam.focusX, cam.focusY),
      originScreen: { x: originX, y: originY },
      originInside: { x: Math.abs(originX) < halfW, y: Math.abs(originY) < halfH },
      edgeGapPx: { x: halfW - Math.abs(originX), y: halfH - Math.abs(originY) },
    });
    writeCamera();
    pipeline.withColorAttachment({ view: context }).draw(3);
    dirty = false;
  }
  requestAnimationFrame(frame);
}

// DPR-aware backing-store sizing, capped at CAMERA.dprCap (Architecture §7.7).
const maxDim = root.device.limits.maxTextureDimension2D;
const observer = new ResizeObserver(([entry]) => {
  if (!entry) {
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, CAMERA.dprCap);
  const cssW = entry.contentBoxSize[0].inlineSize;
  const cssH = entry.contentBoxSize[0].blockSize;
  const w = Math.max(1, Math.min(Math.round(cssW * dpr), maxDim));
  const h = Math.max(1, Math.min(Math.round(cssH * dpr), maxDim));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    dirty = true;
    log.resize.debug('canvas resized', {
      dpr,
      css: { w: cssW, h: cssH },
      device: { w, h },
      maxDim,
      entry,
    });
  }
});
observer.observe(canvas, { box: 'content-box' });

requestAnimationFrame(frame);
