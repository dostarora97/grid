import { clampZoom, unprojectAxis } from './projection';
import { log } from './logger';
import { offsetPx as offsetPxAt, worldAt as worldAtPointer } from './pointer';
import { Spring } from './spring';
import { CAMERA } from './tunables';

/** CPU-side camera state — the authoritative focus + zoom (Architecture §7.1, §8.3). */
export type CameraState = { focusX: number; focusY: number; zoom: number };

/** UI state. `locked` = fly mode (pointer-locked velocity). Unlocked = grab mode
 * (this module: drag to pan, cursor-carry to place, right-click to delete). */
export type UiState = { locked: boolean };

/** The grab-mode slice of the rectangles module (placement + delete by cursor cell). */
type GrabPlacement = {
  isPlacing: () => boolean;
  cellAt: (clientX: number, clientY: number) => [number, number];
  setPlacementCenterCell: (cx: number, cy: number) => void;
  commitPlacement: () => number | null;
  cancelPlacement: () => void;
  deleteAt: (cx: number, cy: number) => void;
};

/**
 * Grab-mode interactions (active when `!ui.locked`): drag to pan (uniform, at the
 * focus scale so edges don't fling), wheel to zoom-about-cursor, double-click to
 * glide the focus. While carrying a media tile, the pointer *is* the tile — moving
 * positions it (cursor cell), left-click drops it, right-click cancels the carry;
 * otherwise right-click deletes the tile under the cursor. Fly mode (locked) is
 * handled in fly.ts. The returned `tick` advances the glide spring (§7.6).
 */
export function attachInteractions(
  canvas: HTMLCanvasElement,
  cam: CameraState,
  ui: UiState,
  markDirty: () => void,
  place: GrabPlacement,
): { tick: (dt: number) => void } {
  const springX = new Spring(cam.focusX);
  const springY = new Spring(cam.focusY);
  let gliding = false;
  let targetX = cam.focusX;
  let targetY = cam.focusY;

  function offsetPx(clientX: number, clientY: number): [number, number] {
    return offsetPxAt(canvas, clientX, clientY);
  }
  function worldAt(clientX: number, clientY: number): [number, number] {
    return worldAtPointer(canvas, cam, clientX, clientY);
  }
  function syncSprings(): void {
    springX.set(cam.focusX);
    springY.set(cam.focusY);
  }

  let panning = false;
  let lastOx = 0;
  let lastOy = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (ui.locked || e.button !== 0) {
      return; // fly mode owns the mouse; non-left buttons don't pan
    }
    if (place.isPlacing()) {
      place.commitPlacement(); // carrying a tile → left-click drops it (no pan)
      return;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort capture; absent for synthetic events.
    }
    panning = true;
    gliding = false;
    [lastOx, lastOy] = offsetPx(e.clientX, e.clientY);
    log.input.debug('pan:start', { client: { x: e.clientX, y: e.clientY }, zoom: cam.zoom });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (place.isPlacing()) {
      // Carrying: the tile follows the cursor cell; hide the OS cursor (tile is it).
      canvas.style.cursor = 'none';
      const [cx, cy] = place.cellAt(e.clientX, e.clientY);
      place.setPlacementCenterCell(cx, cy);
      return;
    }
    if (canvas.style.cursor === 'none') {
      canvas.style.cursor = '';
    }
    if (!panning) {
      return;
    }
    const [ox, oy] = offsetPx(e.clientX, e.clientY);
    cam.focusX -= (ox - lastOx) / cam.zoom;
    cam.focusY -= (oy - lastOy) / cam.zoom;
    lastOx = ox;
    lastOy = oy;
    syncSprings();
    markDirty();
  });

  const endPan = (e: PointerEvent): void => {
    if (!panning) {
      return;
    }
    panning = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Nothing to release for synthetic/uncaptured pointers.
    }
    log.input.debug('pan:end', { focus: { x: cam.focusX, y: cam.focusY } });
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);

  // Right-click: cancel a carry, else delete the tile under the cursor.
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (ui.locked) {
      return; // fly mode handles right-click at the center
    }
    if (place.isPlacing()) {
      place.cancelPlacement();
      return;
    }
    const [cx, cy] = place.cellAt(e.clientX, e.clientY);
    place.deleteAt(cx, cy);
  });

  // Zoom about the cursor: keep that world point fixed (§7.6).
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (ui.locked) {
        return; // fly mode owns zoom (about the center)
      }
      gliding = false;
      const [wx, wy] = worldAt(e.clientX, e.clientY);
      cam.zoom = clampZoom(cam.zoom * Math.exp(-e.deltaY * CAMERA.wheelSensitivity));
      const [ox, oy] = offsetPx(e.clientX, e.clientY);
      cam.focusX = wx - unprojectAxis(ox, canvas.width / 2, cam.zoom);
      cam.focusY = wy - unprojectAxis(oy, canvas.height / 2, cam.zoom);
      syncSprings();
      markDirty();
    },
    { passive: false },
  );

  // Double-click: glide the focus to that world point (disabled while carrying).
  canvas.addEventListener('dblclick', (e) => {
    if (ui.locked || place.isPlacing()) {
      return;
    }
    [targetX, targetY] = worldAt(e.clientX, e.clientY);
    gliding = true;
    log.glide.debug('glide:start', { target: { x: targetX, y: targetY } });
  });

  /** Advance the glide spring by `dt` seconds; a no-op unless a glide is active. */
  function tick(dt: number): void {
    if (!gliding) {
      return;
    }
    const movingX = springX.step(targetX, dt);
    const movingY = springY.step(targetY, dt);
    cam.focusX = springX.value;
    cam.focusY = springY.value;
    markDirty();
    if (!movingX && !movingY) {
      gliding = false;
      log.glide.debug('glide:end', { focus: { x: cam.focusX, y: cam.focusY } });
    }
  }

  return { tick };
}
