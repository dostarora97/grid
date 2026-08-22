import { describe, expect, it } from 'vitest';
import { clampZoom, projectAxis, TAILS, unprojectAxis } from './projection';
import type { TailKind } from './tunables';

const KINDS: TailKind[] = ['rational', 'tanh', 'atan'];

describe('Φ / Φ⁻¹ round-trip (Architecture §13)', () => {
  for (const kind of KINDS) {
    it(`${kind}: project → unproject recovers the world delta`, () => {
      const W = 640;
      const z = 1.7;
      for (const dWorld of [-500, -137.5, -1, 0, 0.25, 42, 300, 613]) {
        const off = projectAxis(dWorld, W, z, kind);
        expect(unprojectAxis(off, W, z, kind)).toBeCloseTo(dWorld, 9);
      }
    });

    it(`${kind}: unproject → project recovers the screen offset`, () => {
      const W = 512;
      const z = 0.8;
      for (const off of [-500, -256, -10, 0, 33, 200, 500]) {
        const dWorld = unprojectAxis(off, W, z, kind);
        expect(projectAxis(dWorld, W, z, kind)).toBeCloseTo(off, 9);
      }
    });
  }
});

describe('edges at infinity, focus at center', () => {
  for (const kind of KINDS) {
    it(`${kind}: |d| → ∞ maps onto the frame edge ±W`, () => {
      const W = 400;
      expect(projectAxis(1e12, W, 1, kind)).toBeCloseTo(W, 6);
      expect(projectAxis(-1e12, W, 1, kind)).toBeCloseTo(-W, 6);
    });

    it(`${kind}: the focus (d = 0) maps to the center (0)`, () => {
      expect(projectAxis(0, 300, 2, kind)).toBe(0);
    });

    it(`${kind}: near-focus magnification ≈ z (unit tail slope)`, () => {
      const W = 800;
      const z = 1.5;
      const d = 1e-5;
      expect(projectAxis(d, W, z, kind) / d).toBeCloseTo(z, 4);
    });
  }
});

describe('zoom-about-cursor keeps the world point under the cursor fixed (§7.6)', () => {
  for (const kind of KINDS) {
    it(`${kind}`, () => {
      const W = 720;
      const off = 210; // cursor offset from center, device px
      const focus0 = 12.34;
      const z0 = 1;
      const worldUnderCursor = focus0 + unprojectAxis(off, W, z0, kind);
      const z1 = clampZoom(z0 * Math.exp(-(-300) * 0.0015)); // wheel zoom-in
      const focus1 = worldUnderCursor - unprojectAxis(off, W, z1, kind);
      const worldAfter = focus1 + unprojectAxis(off, W, z1, kind);
      expect(worldAfter).toBeCloseTo(worldUnderCursor, 10);
      expect(z1).toBeGreaterThan(z0);
    });
  }
});

describe('symmetry: Φ is odd in the world delta', () => {
  for (const kind of KINDS) {
    it(`${kind}`, () => {
      const W = 500;
      const z = 1.2;
      for (const d of [1, 50, 250]) {
        expect(projectAxis(-d, W, z, kind)).toBeCloseTo(-projectAxis(d, W, z, kind), 12);
      }
    });
  }
});

describe('clampZoom', () => {
  it('clamps to the configured [min, max]', () => {
    expect(clampZoom(1000)).toBeLessThanOrEqual(3);
    expect(clampZoom(0.001)).toBeGreaterThanOrEqual(0.35);
    expect(clampZoom(1)).toBe(1);
  });
});

describe('TAILS analytic identities', () => {
  for (const kind of KINDS) {
    it(`${kind}: squash and expand are mutual inverses`, () => {
      for (const p of [-3, -0.5, 0, 0.75, 2.2]) {
        expect(TAILS[kind].expand(TAILS[kind].squash(p))).toBeCloseTo(p, 10);
      }
    });
    it(`${kind}: squash saturates within (−1, 1)`, () => {
      expect(Math.abs(TAILS[kind].squash(1e9))).toBeLessThanOrEqual(1);
      expect(Math.abs(TAILS[kind].squash(-1e9))).toBeLessThanOrEqual(1);
    });
  }
});
