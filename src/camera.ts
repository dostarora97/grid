import { d } from 'typegpu';
import { ADAPTIVE } from './tunables';

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
   * The focus's fractional offset within each adaptive level's cell (in `.xy`),
   * computed on the CPU in f64. The grid phase for every level is measured
   * relative to the focus using these, so the shader's `fract` only ever sees
   * small numbers — keeping the lattice crisp arbitrarily far from the origin
   * (translation invariance; Architecture §8.3). `vec4f` (not `vec2f`) to satisfy
   * the uniform array's 16-byte stride; only `.xy` is used.
   */
  focusLevelFrac: d.arrayOf(d.vec4f, ADAPTIVE.levels),
  /** Derivative-based edge-fade thresholds in device px (Architecture §7.7). */
  fadeStartPx: d.f32,
  fadeEndPx: d.f32,
});
