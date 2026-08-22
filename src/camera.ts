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
   * `.xy` = the focus's fractional offset within each adaptive level's cell
   * (CPU-f64 → precise phase, translation-invariant; Architecture §8.3).
   * `.z` = per-level enable/weight (0 or 1), driven by the settings panel.
   * `vec4f` (not `vec2f`) also satisfies the uniform array's 16-byte stride.
   */
  focusLevelFrac: d.arrayOf(d.vec4f, ADAPTIVE.levels),
  /** Derivative-based edge-fade thresholds in device px (Architecture §7.7). */
  fadeStartPx: d.f32,
  fadeEndPx: d.f32,
  /** Live appearance knobs from the settings panel. */
  lineAlpha: d.f32,
  lineHalfPx: d.f32,
  /** Origin-axes toggle: 1 = shown, 0 = hidden. */
  axesOn: d.f32,
});
