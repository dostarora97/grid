import { common, d, std, tgpu } from 'typegpu';
import { CameraStruct } from './camera';
import { attachInteractions, type CameraState } from './interactions';
import { CAMERA, COLORS, GRID, TAIL, TAIL_MODE } from './tunables';

const canvasEl = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvasEl) {
  throw new Error('#canvas element not found');
}
const canvas: HTMLCanvasElement = canvasEl;

const root = await tgpu.init();
const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });

// CPU-side camera state — the whole per-frame upload (Architecture §7.1, §8.3).
const cam: CameraState = { focusX: 0, focusY: 0, zoom: CAMERA.defaultZoom };

const camera = root.createUniform(CameraStruct, {
  focus: d.vec2f(0, 0),
  zoom: cam.zoom,
  resolution: d.vec2f(1, 1),
  tailMode: TAIL_MODE[TAIL],
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
    const world = c.focus + (p * half) / c.zoom;

    // Analytic gridlines via screen-space derivatives (Architecture §7.5):
    // distance to the nearest line, measured in pixels. Take fwidth of the
    // SMOOTH field (world · invSpacing), never of fract.
    const minorCell = world * INV_MINOR;
    const majorCell = world * INV_MAJOR;

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

let dirty = true;

function writeCamera() {
  camera.write({
    focus: d.vec2f(cam.focusX, cam.focusY),
    zoom: cam.zoom,
    resolution: d.vec2f(canvas.width, canvas.height),
    tailMode: TAIL_MODE[TAIL],
  });
}

// Pan / zoom / focus-glide — all mutate `cam` and mark the frame dirty (§7.6).
const markDirty = () => {
  dirty = true;
};
const interactions = attachInteractions(canvas, cam, markDirty);

let lastTime = performance.now();
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp long stalls
  lastTime = now;
  interactions.tick(dt); // advances the glide spring, marking dirty while moving
  if (dirty) {
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
  }
});
observer.observe(canvas, { box: 'content-box' });

requestAnimationFrame(frame);
