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
