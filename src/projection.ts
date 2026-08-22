import { CAMERA } from './tunables';

/** How far from the exact edge we clamp NDC, avoiding the Φ⁻¹ singularity (Architecture §7.3). */
const EDGE_LIMIT = 1 - 1e-6;

/**
 * Inverse projection Φ⁻¹, one axis (Architecture §7.3): a screen offset from the
 * center (device px) → the world-space delta from the focus. `halfPx` is `Wx`
 * (or `Wy`). This is the CPU twin of the shader's per-pixel inverse, used to map
 * the cursor into world space for interactions.
 */
export function unprojectAxis(offPx: number, halfPx: number, zoom: number): number {
  const u = offPx / halfPx;
  const uc = Math.max(-EDGE_LIMIT, Math.min(EDGE_LIMIT, u));
  return (uc * halfPx) / (zoom * (1 - Math.abs(uc)));
}

/**
 * Forward projection Φ, one axis (Architecture §7.2): a world delta from the
 * focus → the screen offset from center (device px). The exact inverse of
 * `unprojectAxis`; used by the round-trip tests.
 */
export function projectAxis(dWorld: number, halfPx: number, zoom: number): number {
  return (halfPx * (zoom * dWorld)) / (zoom * Math.abs(dWorld) + halfPx);
}

/** Clamp the center zoom `z` to the configured range (Architecture §7.6). */
export function clampZoom(zoom: number): number {
  return Math.max(CAMERA.zoomMin, Math.min(CAMERA.zoomMax, zoom));
}
