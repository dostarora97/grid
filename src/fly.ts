import type { CameraState, UiState } from './interactions';
import { log } from './logger';
import { clampZoom } from './projection';
import { CAMERA, GRID } from './tunables';

/** The slice of the rectangles module fly mode drives (all action at the center). */
type RectFlyApi = {
  setGhost: (on: boolean) => void;
  stampCenter: () => void;
  beginCenterStroke: () => void;
  sizeStrokeByCells: (dx: number, dy: number) => void;
  commitCenterStroke: () => void;
  cancelCenterStroke: () => void;
  deleteAtCenter: () => void;
};

/** Live copy of the FLY tunables (mutable so the panel/console can tweak feel). */
export type FlyTune = {
  sensitivity: number;
  radiusPx: number;
  deadzonePx: number;
  maxSpeedPx: number;
  curveExp: number;
  unadjustedMovement: boolean;
  showHud: boolean;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Pan speed (screen px/s) from a virtual joystick offset: exactly zero inside the
 * dead-zone, then ramping as `norm^curveExp` up to `maxSpeedPx` at the clamp
 * radius, aimed along the stick direction. Pure (no lock/DOM) so it's unit-tested.
 */
export function flyVelocity(
  stickX: number,
  stickY: number,
  tune: Pick<FlyTune, 'deadzonePx' | 'radiusPx' | 'maxSpeedPx' | 'curveExp'>,
): [number, number] {
  const mag = Math.hypot(stickX, stickY);
  if (mag <= tune.deadzonePx) {
    return [0, 0];
  }
  const norm = Math.min((mag - tune.deadzonePx) / (tune.radiusPx - tune.deadzonePx), 1);
  const speed = tune.maxSpeedPx * norm ** tune.curveExp;
  return [(stickX / mag) * speed, (stickY / mag) * speed];
}

/**
 * Fly mode — velocity steering under Pointer Lock (experiment; ARCHITECTURE §16).
 * The OS cursor is hidden and locked to the canvas center; raw mouse deltas
 * integrate into a virtual joystick "stick" (clamped to a radius), whose distance
 * from center sets a continuous pan SPEED (÷zoom → constant on-screen feel). The
 * center cell is always the focus, so drawing happens *there*: left-click stamps
 * a 1×1, right-click deletes under center, Space hard-stops. Holding **Shift** is
 * a spring-loaded draw: it freezes flying and lets the mouse size a rectangle from
 * the center anchor (1:1 with the on-screen grid); releasing Shift commits and
 * resumes flying. Pan/zoom translate the focus *before* Φ, so the world slides
 * uniformly and re-warps each frame (§8.3) — same math as uniform pan.
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
  toggle: () => void;
  enter: () => void;
  exit: () => void;
  stick: () => [number, number];
  isSizing: () => boolean;
} {
  const { canvas, cam, ui, rects, tune, markDirty, onLock } = opts;

  // Virtual joystick offset in "stick px", Y-up (screen-up is +). No auto-center:
  // hold off-center → keep moving; the physical mouse must travel back to stop.
  let stickX = 0;
  let stickY = 0;
  // Spring-loaded draw (Shift held): flying freezes and mouse deltas integrate into
  // a cell offset from the anchor instead of steering. `sizeAccum` is in device px.
  let sizing = false;
  let sizeAccumX = 0;
  let sizeAccumY = 0;

  function enter(): void {
    // Must be called from a user gesture. Chrome returns a Promise; older returns
    // void. Request raw (unaccelerated) deltas for a predictable joystick feel.
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

  function toggle(): void {
    if (ui.locked) {
      exit();
    } else {
      enter();
    }
  }

  /** Begin a spring-loaded draw: freeze flying, anchor at center, reset the offset. */
  function beginSizing(): void {
    sizing = true;
    sizeAccumX = 0;
    sizeAccumY = 0;
    rects.beginCenterStroke();
  }

  /** End a spring-loaded draw: commit (if valid) and resume flying. */
  function endSizing(commit: boolean): void {
    if (!sizing) {
      return;
    }
    sizing = false;
    if (commit) {
      rects.commitCenterStroke();
    } else {
      rects.cancelCenterStroke();
    }
  }

  function handleLockChange(): void {
    const locked = document.pointerLockElement === canvas;
    ui.locked = locked;
    stickX = 0;
    stickY = 0;
    if (locked) {
      log.input.debug('fly:enter');
    } else {
      endSizing(false); // dropped lock mid-draw → discard
      rects.setGhost(false); // clear any leftover targeting cell
      canvas.style.cursor = '';
      log.input.debug('fly:exit');
    }
    if (locked) {
      canvas.style.cursor = 'none';
    }
    markDirty();
    onLock?.(locked);
  }
  document.addEventListener('pointerlockchange', handleLockChange);
  document.addEventListener('pointerlockerror', () => {
    log.input.warn('fly:lock:rejected (needs a user gesture, or re-lock cooldown after Esc)');
  });

  // Motion under lock: while sizing (Shift), integrate deltas into a cell offset
  // (1:1 with the on-screen grid); otherwise integrate into the steering stick.
  document.addEventListener('mousemove', (e) => {
    if (!ui.locked) {
      return;
    }
    if (sizing) {
      sizeAccumX += e.movementX;
      sizeAccumY -= e.movementY; // screen Y-down → world Y-up
      const pxPerCell = GRID.spacing * cam.zoom; // on-screen cell width at center
      rects.sizeStrokeByCells(
        Math.round(sizeAccumX / pxPerCell),
        Math.round(sizeAccumY / pxPerCell),
      );
      return;
    }
    stickX = clamp(stickX + e.movementX * tune.sensitivity, -tune.radiusPx, tune.radiusPx);
    stickY = clamp(stickY - e.movementY * tune.sensitivity, -tune.radiusPx, tune.radiusPx);
  });

  // Buttons under lock: left = stamp a 1×1, right = delete under center. (Sized
  // rectangles are drawn with Shift; buttons are ignored while sizing.)
  canvas.addEventListener('mousedown', (e) => {
    if (!ui.locked || sizing) {
      return;
    }
    e.preventDefault();
    if (e.button === 0) {
      rects.stampCenter();
    } else if (e.button === 2) {
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
    if (!ui.locked) {
      return;
    }
    if (e.key === 'Shift' && !sizing) {
      beginSizing(); // spring-loaded draw: freeze + size from the center anchor
    } else if (e.code === 'Space') {
      e.preventDefault();
      stickX = 0;
      stickY = 0;
      log.input.debug('fly:stop');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (ui.locked && e.key === 'Shift') {
      endSizing(true); // release → commit the sized rectangle, resume flying
    }
  });

  /** Pan speed (screen px/s) from the stick: dead-zone → 0, ramps as norm^curveExp. */
  function velocity(): [number, number] {
    return flyVelocity(stickX, stickY, tune);
  }

  /** Advance fly steering by `dt`s: integrate the focus (unless sizing = frozen). */
  function tick(dt: number): void {
    if (!ui.locked || sizing) {
      return; // while Shift-sizing the world is frozen (no pan)
    }
    const [vsx, vsy] = velocity();
    if (vsx !== 0 || vsy !== 0) {
      // Screen px/s ÷ zoom → world units/s, so the on-screen speed is zoom-stable.
      cam.focusX += (vsx / cam.zoom) * dt;
      cam.focusY += (vsy / cam.zoom) * dt;
      markDirty();
    }
  }

  return { tick, toggle, enter, exit, stick: () => [stickX, stickY], isSizing: () => sizing };
}
