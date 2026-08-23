import type { CameraState, UiState } from './interactions';
import { log } from './logger';
import { clampZoom } from './projection';
import { CAMERA } from './tunables';

/** The slice of the rectangles module fly mode drives. */
type RectFlyApi = {
  isPlacing: () => boolean;
  setPlacementCenterWorld: (wx: number, wy: number) => void;
  commitPlacement: () => number | null;
  cancelPlacement: () => void;
  deleteAtCenter: () => void;
};

/** Live copy of the FLY tunables (mutable so the panel/console can tweak feel). */
export type FlyTune = {
  sensitivity: number;
  deadzonePx: number;
  maxSpeedPx: number;
  curveExp: number;
  unadjustedMovement: boolean;
  showHud: boolean;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Half the viewport (CSS px) — the crosshair sits at its center; the stick clamps
 * to this rectangle, so the ring can reach any on-screen point (corners included). */
function halfExtents(): [number, number] {
  return [window.innerWidth / 2, window.innerHeight / 2];
}

/**
 * Pan speed (screen px/s) from a virtual joystick offset: exactly zero inside the
 * dead-zone, then ramping as `norm^curveExp` up to `maxSpeedPx` at `radiusPx`
 * (the far corner = half-diagonal), aimed along the stick direction. Pure (no
 * lock/DOM) so it's unit-tested.
 */
export function flyVelocity(
  stickX: number,
  stickY: number,
  radiusPx: number,
  tune: Pick<FlyTune, 'deadzonePx' | 'maxSpeedPx' | 'curveExp'>,
): [number, number] {
  const mag = Math.hypot(stickX, stickY);
  if (mag <= tune.deadzonePx) {
    return [0, 0];
  }
  const norm = Math.min((mag - tune.deadzonePx) / (radiusPx - tune.deadzonePx), 1);
  const speed = tune.maxSpeedPx * norm ** tune.curveExp;
  return [(stickX / mag) * speed, (stickY / mag) * speed];
}

/**
 * Fly mode — velocity steering under Pointer Lock (experiment; ARCHITECTURE §16).
 * Locked = "fly"; unlocked = "grab" (Shift toggles, in main). The OS cursor hides
 * and locks to center; raw mouse deltas integrate into a virtual joystick whose
 * offset sets a continuous pan SPEED (÷zoom → constant on-screen feel).
 *
 * Carrying media (fly-carry): while a media tile is pending, flying still moves the
 * world and the tile stays **pinned to the center cell** (tracked each tick); a
 * left-click drops it at center, right-click deletes the tile under center, Space
 * hard-stops. (Grab-carry — tile follows the cursor — lives in interactions.ts.)
 */
export function attachFly(opts: {
  canvas: HTMLCanvasElement;
  cam: CameraState;
  ui: UiState;
  rects: RectFlyApi;
  tune: FlyTune;
  markDirty: () => void;
  onLock?: (locked: boolean) => void;
}): {
  tick: (dt: number) => void;
  enter: () => void;
  exit: () => void;
  stick: () => [number, number];
  isPlacing: () => boolean;
} {
  const { canvas, cam, ui, rects, tune, markDirty, onLock } = opts;

  let stickX = 0;
  let stickY = 0;

  function enter(): void {
    // Must be called from a user gesture. Request raw (unaccelerated) deltas.
    const request = canvas.requestPointerLock.bind(canvas) as (o?: {
      unadjustedMovement?: boolean;
    }) => Promise<void> | undefined;
    const result = request({ unadjustedMovement: tune.unadjustedMovement });
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((err: unknown) => {
        log.input.warn('fly:lock:error', { err: String(err) });
      });
    }
  }

  function exit(): void {
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  }

  function handleLockChange(): void {
    const locked = document.pointerLockElement === canvas;
    ui.locked = locked;
    stickX = 0;
    stickY = 0;
    canvas.style.cursor = locked ? 'none' : '';
    if (!locked && rects.isPlacing()) {
      rects.cancelPlacement(); // Esc / lost lock mid-placement → discard the carry
    }
    log.input.debug(locked ? 'fly:enter' : 'fly:exit');
    markDirty();
    onLock?.(locked);
  }
  document.addEventListener('pointerlockchange', handleLockChange);
  document.addEventListener('pointerlockerror', () => {
    log.input.warn('fly:lock:rejected (needs a user gesture, or re-lock cooldown after Esc)');
  });

  // Steering: integrate deltas into the joystick (screen Y-down → world Y-up).
  document.addEventListener('mousemove', (e) => {
    if (!ui.locked) {
      return;
    }
    const [hw, hh] = halfExtents();
    stickX = clamp(stickX + e.movementX * tune.sensitivity, -hw, hw);
    stickY = clamp(stickY - e.movementY * tune.sensitivity, -hh, hh);
  });

  // Left = drop the carried tile; right = delete the tile under the center.
  canvas.addEventListener('mousedown', (e) => {
    if (!ui.locked) {
      return;
    }
    if (rects.isPlacing()) {
      if (e.button === 0) {
        e.preventDefault();
        rects.commitPlacement();
      }
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      rects.deleteAtCenter();
    }
  });

  // Zoom about the center while locked (the center is the focus → focus stays fixed).
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!ui.locked) {
        return;
      }
      e.preventDefault();
      cam.zoom = clampZoom(cam.zoom * Math.exp(-e.deltaY * CAMERA.wheelSensitivity));
      markDirty();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (ui.locked && e.code === 'Space') {
      e.preventDefault();
      stickX = 0;
      stickY = 0;
      log.input.debug('fly:stop');
    }
  });

  /** Pan speed (screen px/s) from the stick: dead-zone → 0, corner = max. */
  function velocity(): [number, number] {
    const [hw, hh] = halfExtents();
    return flyVelocity(stickX, stickY, Math.hypot(hw, hh), tune);
  }

  /** Advance fly by `dt`s: integrate the focus; keep any carried tile pinned to center. */
  function tick(dt: number): void {
    if (!ui.locked) {
      return;
    }
    const [vsx, vsy] = velocity();
    if (vsx !== 0 || vsy !== 0) {
      cam.focusX += (vsx / cam.zoom) * dt;
      cam.focusY += (vsy / cam.zoom) * dt;
      markDirty();
    }
    if (rects.isPlacing()) {
      rects.setPlacementCenterWorld(cam.focusX, cam.focusY); // pinned to center as the world flies
    }
  }

  return { tick, enter, exit, stick: () => [stickX, stickY], isPlacing: () => rects.isPlacing() };
}
