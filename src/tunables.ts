/*
 * Grid + camera tunables — the real design knobs (Architecture §6.7, §7.7).
 * Values are read both on the CPU (camera/interactions) and inlined into the
 * TGSL grid shader as constants.
 */

/** The grid lattice (Architecture §6.2). */
export const GRID = {
  /** World-space side length of a square cell, in world units. */
  spacing: 40,
  /** A major line every this many cells (graph-paper convention). */
  major: 5,
  /** Half line-widths in device pixels (full width ≈ 2× these). */
  minorHalfPx: 0.5,
  majorHalfPx: 0.75,
  axisHalfPx: 1.1,
} as const;

/**
 * Derivative-based edge fade (option A). A line family's on-screen cell spacing
 * is `1 / fwidth(cell)` device px; it fades out below `startPx` (where lines
 * bunch toward the edge) and is fully shown above `endPx`, crossfading between.
 * This dissolves the dense edge band into a clean recession instead of gray
 * mush. Majors persist deeper than minors for free (5× the spacing).
 * Live-tunable via `window.gridTune.fade(startPx, endPx)`.
 */
export const FADE = {
  startPx: 2.5,
  endPx: 9,
} as const;

/**
 * Adaptive multi-level grid (option B / A+B). We render `levels` nested grids at
 * world spacings G·base^0 … G·base^(levels-1), each anti-aliased and faded by
 * the same derivative rule as A. Near the center several levels overlap and the
 * additive coincidence recreates minor/major/super-major for free (a line shared
 * by a coarser level gets brighter); toward the edge fine levels fade out while
 * coarser ones stay crisp — so the lattice reaches to within a fraction of a
 * pixel of the edge with no mush and no empty margin.
 */
export const ADAPTIVE = {
  /** Number of nested levels (covers G … G·base^(levels-1) world spacing). */
  levels: 10,
  /** Ratio between adjacent levels — reuses the major interval. */
  base: GRID.major,
  /** Line half-width in device px, shared by all levels. */
  halfPx: 0.5,
  /** Per-level opacity; additive nesting builds the visual hierarchy. */
  alpha: 0.06,
} as const;

/**
 * Directional opponent-color tint (CIELAB-style "compass to infinity", §6.4):
 * the plane is tinted by screen direction from the focus — neutral at the
 * center, saturating toward each edge. Image-1 assignment: up = red (+a),
 * down = green (−a), left = yellow (+b), right = blue (−b).
 */
export const TINT = {
  /** Overall tint strength; 0 = off. */
  strength: 0.25,
  /** World-space radius of the neutral halo around the origin (tanh scale). */
  scale: 10000,
  up: [0.95, 0.2, 0.2],
  down: [0.2, 0.8, 0.3],
  left: [0.95, 0.85, 0.15],
  right: [0.25, 0.4, 1.0],
} as const;

/** Colors: background rgb (sRGB 0..1) + per-class line opacities over the background. */
export const COLORS = {
  // #0E1116
  bgR: 0.0549,
  bgG: 0.0667,
  bgB: 0.0863,
  minorAlpha: 0.07,
  majorAlpha: 0.16,
  axisAlpha: 0.42,
} as const;

/** Camera + interaction tunables (Architecture §7.6, §7.7). */
export const CAMERA = {
  /** Center zoom `z`: device px per world unit at the focus. */
  defaultZoom: 1,
  zoomMin: 0.35,
  zoomMax: 3,
  /** Exponential wheel-zoom sensitivity. */
  wheelSensitivity: 0.0015,
  /** devicePixelRatio cap (Architecture §7.7). */
  dprCap: 2,
} as const;

/**
 * The Φ tail (Architecture §7.7) — how fast distant content compresses toward
 * the edge. 'rational' has a heavy 1/d tail (keeps the most far context),
 * 'tanh' an exponential tail (keeps the least), 'atan' sits between. A genuine,
 * swappable design knob; anisotropic distortion is locked for v1.
 */
export type TailKind = 'rational' | 'tanh' | 'atan';
export const TAIL: TailKind = 'rational';

/** Numeric tail selector uploaded in the camera uniform (must match the shader). */
export const TAIL_MODE: Record<TailKind, number> = { rational: 0, tanh: 1, atan: 2 };

/**
 * Fly mode — velocity steering under pointer lock (experiment). The cursor is
 * locked at the screen center; raw mouse deltas integrate into a virtual "stick"
 * offset, clamped to the **viewport rectangle** so the HUD ring can reach any
 * on-screen point (including the corners). The stick's radial distance sets a
 * continuous pan SPEED — the farthest corner (half-diagonal) = `maxSpeedPx`,
 * everything nearer scales radially as `norm^curveExp`; a dead-zone gives a true
 * zero at center. Speed is screen px/s (÷zoom → zoom-stable). See ARCHITECTURE §16.
 */
export const FLY = {
  /** Stick px gained per raw (unaccelerated) movement px. */
  sensitivity: 2,
  /** Below this |stick|, velocity is exactly zero. */
  deadzonePx: 14,
  /** Max pan speed, reached at the far corner, in *screen* px/s (÷zoom → world). */
  maxSpeedPx: 3200,
  /** Speed-curve exponent (>1 gives finer low-speed control). */
  curveExp: 1.5,
  /** Request raw, OS-acceleration-free deltas (Chrome `unadjustedMovement`). */
  unadjustedMovement: true,
  /** Show the fly ring + hint while flying (crosshair always shows). Off by default. */
  showHud: false,
} as const;
