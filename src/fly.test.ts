import { describe, expect, it } from 'vitest';
import { flyVelocity, type FlyTune } from './fly';

const RADIUS = 110; // stand-in for the viewport half-diagonal (corner distance)
const TUNE: Pick<FlyTune, 'deadzonePx' | 'maxSpeedPx' | 'curveExp'> = {
  deadzonePx: 10,
  maxSpeedPx: 1000,
  curveExp: 2,
};

describe('flyVelocity', () => {
  it('is exactly zero at center and inside the dead-zone', () => {
    expect(flyVelocity(0, 0, RADIUS, TUNE)).toEqual([0, 0]);
    expect(flyVelocity(9, 0, RADIUS, TUNE)).toEqual([0, 0]);
    expect(flyVelocity(0, -10, RADIUS, TUNE)).toEqual([0, 0]); // on the dead-zone edge
  });

  it('reaches max speed at (and beyond) the radius = corner distance', () => {
    const [vx] = flyVelocity(110, 0, RADIUS, TUNE);
    expect(vx).toBeCloseTo(1000, 6); // norm = 1 → full speed
    const [vx2] = flyVelocity(500, 0, RADIUS, TUNE);
    expect(vx2).toBeCloseTo(1000, 6); // clamped past the radius
  });

  it('ramps as norm^curveExp between dead-zone and radius', () => {
    // Halfway in stick distance: mag = 60 → norm = (60-10)/(110-10) = 0.5 → 0.25·max.
    const [vx] = flyVelocity(60, 0, RADIUS, TUNE);
    expect(vx).toBeCloseTo(250, 6);
  });

  it('aims along the stick direction (unit vector × speed)', () => {
    const [vx, vy] = flyVelocity(60, 60, RADIUS, TUNE);
    const mag = Math.hypot(60, 60);
    const norm = (mag - 10) / 100;
    const speed = 1000 * norm ** 2;
    expect(vx).toBeCloseTo((60 / mag) * speed, 4);
    expect(vy).toBeCloseTo((60 / mag) * speed, 4);
    expect(vx).toBeCloseTo(vy, 6); // 45° → equal components
  });

  it('carries the sign of the stick (all four directions)', () => {
    expect(flyVelocity(-60, 0, RADIUS, TUNE)[0]).toBeLessThan(0);
    expect(flyVelocity(0, -60, RADIUS, TUNE)[1]).toBeLessThan(0);
    expect(flyVelocity(0, 60, RADIUS, TUNE)[1]).toBeGreaterThan(0);
  });
});
