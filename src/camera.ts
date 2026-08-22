import { d } from 'typegpu';

/**
 * The camera uniform — the entire per-frame CPU→GPU upload (Architecture §7.1).
 *
 * - `focus`: the world point held at the screen center (the region at full scale).
 * - `zoom`: center zoom `z` — device pixels per world unit at the focus.
 * - `resolution`: device-pixel viewport size (its halves are `Wx, Wy`).
 *
 * Separable, per-axis: X depends only on horizontal distance from the focus,
 * Y only on vertical distance (Architecture §2).
 */
export const CameraStruct = d.struct({
  focus: d.vec2f,
  zoom: d.f32,
  resolution: d.vec2f,
  /** Φ tail selector: 0 = rational, 1 = tanh, 2 = atan (Architecture §7.7). */
  tailMode: d.f32,
  /**
   * The focus's fractional offset within a minor / major cell, computed on the
   * CPU in f64. The grid phase is measured *relative to the focus* using these,
   * so the shader's `fract` only ever sees small numbers — this is what keeps
   * the lattice crisp arbitrarily far from the origin (translation invariance;
   * Architecture §8.3). Only the fractional part matters to `fract`, so these
   * carry all the position information the grid needs, with none of the
   * precision-destroying magnitude.
   */
  focusMinorFrac: d.vec2f,
  focusMajorFrac: d.vec2f,
  /** Derivative-based edge-fade thresholds in device px (Architecture §7.7, option A). */
  fadeStartPx: d.f32,
  fadeEndPx: d.f32,
});
