import { common, d, std, tgpu } from 'typegpu';
import { CameraStruct } from './camera';
import { attachInteractions, type CameraState } from './interactions';
import { log } from './logger';
import { createSettingsPanel, type Settings } from './panel';
import { projectAxis } from './projection';
import { attachInputTelemetry } from './telemetry';
import { ADAPTIVE, CAMERA, COLORS, FADE, GRID, TAIL, TAIL_MODE, TINT } from './tunables';

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

// Adaptive-grid structure (inlined into the shader as literals).
const LEVELS = ADAPTIVE.levels;
const BASE = ADAPTIVE.base;

/** Live render settings, driven by the settings panel and uploaded each frame. */
const settings: Settings = {
  levels: Array.from({ length: LEVELS }, () => true),
  fadeStartPx: FADE.startPx,
  fadeEndPx: FADE.endPx,
  lineAlpha: ADAPTIVE.alpha,
  lineHalfPx: ADAPTIVE.halfPx,
  tailMode: TAIL_MODE[TAIL],
  axesOn: true,
  tintStrength: TINT.strength,
  tintScale: TINT.scale,
};

const camera = root.createUniform(CameraStruct, {
  focus: d.vec2f(0, 0),
  zoom: cam.zoom,
  resolution: d.vec2f(1, 1),
  tailMode: settings.tailMode,
  focusLevelFrac: Array.from({ length: LEVELS }, () => d.vec4f(0, 0, 1, 0)),
  fadeStartPx: settings.fadeStartPx,
  fadeEndPx: settings.fadeEndPx,
  lineAlpha: settings.lineAlpha,
  lineHalfPx: settings.lineHalfPx,
  axesOn: 1,
  tintStrength: settings.tintStrength,
  tintScale: settings.tintScale,
});

// Colors captured by the shader as GPU constants.
const BG = d.vec3f(COLORS.bgR, COLORS.bgG, COLORS.bgB);
const LINE = d.vec3f(1, 1, 1);

// Direction-tint opponent colors (a color compass to infinity; §6.4).
const DIR_UP = d.vec3f(TINT.up[0], TINT.up[1], TINT.up[2]);
const DIR_DOWN = d.vec3f(TINT.down[0], TINT.down[1], TINT.down[2]);
const DIR_LEFT = d.vec3f(TINT.left[0], TINT.left[1], TINT.left[2]);
const DIR_RIGHT = d.vec3f(TINT.right[0], TINT.right[1], TINT.right[2]);

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

    // World units per pixel, per axis (from the relative delta → precision-safe).
    const wpp = std.fwidth(delta);

    // Adaptive multi-level grid (option B / A+B): sum LEVELS nested grids at world
    // spacing G·BASE^n, each fract-based and fwidth-anti-aliased, faded out where
    // its on-screen cell spacing (1/cpp) drops below fadeStartPx. Additive nesting
    // makes shared (coarser) lines brighter → minor/major/super-major for free;
    // coarse levels stay crisp to the edge where fine ones have faded.
    let grid = d.f32(0);
    for (let n = 0; n < LEVELS; n++) {
      const spacing = GRID.spacing * std.pow(d.f32(BASE), d.f32(n));
      const frac = c.focusLevelFrac[n]; // .xy = phase offset, .z = per-level weight
      const cpp = wpp / spacing; // cells per pixel, per axis
      const fieldX = delta.x / spacing + frac.x;
      const fieldY = delta.y / spacing + frac.y;
      const distX = std.abs(std.fract(fieldX - 0.5) - 0.5) / cpp.x;
      const distY = std.abs(std.fract(fieldY - 0.5) - 0.5) / cpp.y;
      const fadeX = std.smoothstep(c.fadeStartPx, c.fadeEndPx, d.f32(1) / cpp.x);
      const fadeY = std.smoothstep(c.fadeStartPx, c.fadeEndPx, d.f32(1) / cpp.y);
      const lineCov = std.max(
        lineCoverage(distX, c.lineHalfPx) * fadeX,
        lineCoverage(distY, c.lineHalfPx) * fadeY,
      );
      // frac.z is the per-level enable/weight (0 or 1) from the settings panel.
      grid = grid + lineCov * c.lineAlpha * frac.z;
    }

    // Origin axes on top (absolute world; precise exactly when the origin is in view).
    const axisD = std.abs(world) / std.fwidth(world);
    const axis = std.max(
      lineCoverage(axisD.x, GRID.axisHalfPx),
      lineCoverage(axisD.y, GRID.axisHalfPx),
    );

    // Directional opponent-color tint painted onto the WORLD (not the screen):
    // color is a function of the world coordinate under this pixel, so it pans,
    // compresses toward the edges, and expands at the focus exactly like the
    // grid — one fabric. The color coordinate saturates with distance from the
    // world origin: neutral at the origin, full at ±∞ (the edges). +x=blue,
    // −x=yellow, +y=red, −y=green (§6.4).
    // Rational squash (overflow-safe): neutral at the origin, saturating to ±1
    // at ±∞. We avoid tanh here because near the edges world/scale reaches ~1e6,
    // and GPU tanh (via e^x) overflows f32 to NaN there — which showed up as
    // colored bands in the outermost pixels. p/(|p|+1) never overflows.
    const tx = world.x / c.tintScale;
    const ty = world.y / c.tintScale;
    const cx = tx / (std.abs(tx) + 1);
    const cy = ty / (std.abs(ty) + 1);
    const tint =
      DIR_UP * std.max(cy, d.f32(0)) +
      DIR_DOWN * std.max(-cy, d.f32(0)) +
      DIR_LEFT * std.max(-cx, d.f32(0)) +
      DIR_RIGHT * std.max(cx, d.f32(0));
    const tintedBg = BG + tint * c.tintStrength;

    const gridColor = std.mix(tintedBg, LINE, std.clamp(grid, d.f32(0), d.f32(1)));
    const out = std.mix(gridColor, LINE, axis * COLORS.axisAlpha * c.axesOn);
    return d.vec4f(out, 1);
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
  // Per-level: .xy = precise f64 fractional focus offset, .z = enable weight.
  const levelFrac: d.v4f[] = [];
  for (let n = 0; n < LEVELS; n++) {
    const spacing = GRID.spacing * BASE ** n;
    const weight = settings.levels[n] ? 1 : 0;
    levelFrac.push(
      d.vec4f(cellFraction(cam.focusX, spacing), cellFraction(cam.focusY, spacing), weight, 0),
    );
  }
  log.camera.silly('write', {
    focus: { x: cam.focusX, y: cam.focusY },
    zoom: cam.zoom,
    resolution: { w: canvas.width, h: canvas.height },
    tailMode: settings.tailMode,
    fade: { startPx: settings.fadeStartPx, endPx: settings.fadeEndPx },
    lineAlpha: settings.lineAlpha,
    lineHalfPx: settings.lineHalfPx,
    axesOn: settings.axesOn,
    levels: settings.levels,
  });
  camera.write({
    focus: d.vec2f(cam.focusX, cam.focusY),
    zoom: cam.zoom,
    resolution: d.vec2f(canvas.width, canvas.height),
    tailMode: settings.tailMode,
    focusLevelFrac: levelFrac,
    fadeStartPx: settings.fadeStartPx,
    fadeEndPx: settings.fadeEndPx,
    lineAlpha: settings.lineAlpha,
    lineHalfPx: settings.lineHalfPx,
    axesOn: settings.axesOn ? 1 : 0,
    tintStrength: settings.tintStrength,
    tintScale: settings.tintScale,
  });
}

// Pan / zoom / focus-glide — all mutate `cam` and mark the frame dirty (§7.6).
const markDirty = () => {
  dirty = true;
};

declare global {
  interface Window {
    /** Live render settings, exposed for console inspection/tweaking. */
    gridSettings: Settings;
  }
}
if (typeof window !== 'undefined') {
  window.gridSettings = settings;
}

// Settings panel — DOM chrome around the canvas (Architecture §16).
createSettingsPanel({
  settings,
  cam,
  levelCount: LEVELS,
  levelSpacing: (n) => GRID.spacing * BASE ** n,
  zoomRange: [CAMERA.zoomMin, CAMERA.zoomMax],
  onChange: markDirty,
  resetView: () => {
    cam.focusX = 0;
    cam.focusY = 0;
    cam.zoom = CAMERA.defaultZoom;
    markDirty();
  },
});

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
