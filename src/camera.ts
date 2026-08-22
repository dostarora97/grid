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
});
