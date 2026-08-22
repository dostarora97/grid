/**
 * A critically-damped spring toward a (possibly moving) target — smooth, no
 * overshoot, interruptible. Backs the focus-glide (Architecture §7.6): a spring
 * gives better feel than fixed easing and can be redirected mid-flight.
 */
export class Spring {
  value: number;
  private velocity = 0;
  private readonly stiffness: number;

  constructor(value: number, stiffness = 120) {
    this.value = value;
    this.stiffness = stiffness;
  }

  /** Jump to a value and kill velocity (used when pan/zoom take over). */
  set(value: number): void {
    this.value = value;
    this.velocity = 0;
  }

  /** Advance toward `target` by `dt` seconds. Returns true while still moving. */
  step(target: number, dt: number): boolean {
    const k = this.stiffness;
    const damping = 2 * Math.sqrt(k); // critical damping: no overshoot
    // Sub-step semi-implicit Euler for stability across variable frame times.
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const accel = -k * (this.value - target) - damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - target) < 1e-3 && Math.abs(this.velocity) < 1e-3) {
      this.value = target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}
