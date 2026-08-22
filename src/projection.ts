import { CAMERA, TAIL, type TailKind } from './tunables';

/** How far from the exact edge we clamp NDC, avoiding the Φ⁻¹ singularity (Architecture §7.3). */
const EDGE_LIMIT = 1 - 1e-6;

type Tail = {
  /** world→screen squash, in normalized coords: p = z·d/W → u = o/W ∈ (−1,1). */
  squash: (p: number) => number;
  /** screen→world expand, the exact inverse of `squash`. */
  expand: (u: number) => number;
};

/** The three Φ tails (Architecture §7.7). Must mirror the shader's `expandTail`. */
export const TAILS: Record<TailKind, Tail> = {
  rational: { squash: (p) => p / (Math.abs(p) + 1), expand: (u) => u / (1 - Math.abs(u)) },
  tanh: { squash: (p) => Math.tanh(p), expand: (u) => 0.5 * Math.log((1 + u) / (1 - u)) },
  atan: {
    squash: (p) => (2 / Math.PI) * Math.atan((Math.PI / 2) * p),
    expand: (u) => (2 / Math.PI) * Math.tan((Math.PI / 2) * u),
  },
};

/**
 * Forward projection Φ, one axis (Architecture §7.2): a world delta from the
 * focus → the screen offset from center (device px). `halfPx` is `Wx` or `Wy`.
 */
export function projectAxis(
  dWorld: number,
  halfPx: number,
  zoom: number,
  kind: TailKind = TAIL,
): number {
  return TAILS[kind].squash((zoom * dWorld) / halfPx) * halfPx;
}

/**
 * Inverse projection Φ⁻¹, one axis (Architecture §7.3): a screen offset from the
 * center (device px) → the world-space delta from the focus. The CPU twin of the
 * shader's per-pixel inverse, used to map the cursor into world space.
 */
export function unprojectAxis(
  offPx: number,
  halfPx: number,
  zoom: number,
  kind: TailKind = TAIL,
): number {
  const u = Math.max(-EDGE_LIMIT, Math.min(EDGE_LIMIT, offPx / halfPx));
  return (TAILS[kind].expand(u) * halfPx) / zoom;
}

/** Clamp the center zoom `z` to the configured range (Architecture §7.6). */
export function clampZoom(zoom: number): number {
  return Math.max(CAMERA.zoomMin, Math.min(CAMERA.zoomMax, zoom));
}
