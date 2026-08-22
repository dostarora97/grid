import { clampZoom, unprojectAxis } from './projection';
import { log } from './logger';
import { Spring } from './spring';
import { CAMERA } from './tunables';

/** CPU-side camera state — the authoritative focus + zoom (Architecture §7.1, §8.3). */
export type CameraState = { focusX: number; focusY: number; zoom: number };

/**
 * Wire pan (grab-and-pull), zoom-about-cursor, and focus-glide to the canvas.
 * Every handler changes only `cam` (never the data) and calls `markDirty`; the
 * returned `tick` advances the interruptible glide spring each frame (§7.6).
 */
export function attachInteractions(
  canvas: HTMLCanvasElement,
  cam: CameraState,
  markDirty: () => void,
): { tick: (dt: number) => void } {
  const springX = new Spring(cam.focusX);
  const springY = new Spring(cam.focusY);
  let gliding = false;
  let targetX = cam.focusX;
  let targetY = cam.focusY;

  /** Pointer offset from the screen center, in device px, Y-up (matches the shader). */
  function offsetPx(clientX: number, clientY: number): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const ox = (clientX - rect.left) * scaleX - canvas.width / 2;
    const oy = canvas.height / 2 - (clientY - rect.top) * scaleY;
    return [ox, oy];
  }

  /** World point under the cursor via Φ⁻¹, at the current camera. */
  function worldAt(clientX: number, clientY: number): [number, number] {
    const [ox, oy] = offsetPx(clientX, clientY);
    return [
      cam.focusX + unprojectAxis(ox, canvas.width / 2, cam.zoom),
      cam.focusY + unprojectAxis(oy, canvas.height / 2, cam.zoom),
    ];
  }

  function syncSprings(): void {
    springX.set(cam.focusX);
    springY.set(cam.focusY);
  }

  // --- Pan: uniform drag at the focus scale (1/zoom) — constant rate no matter
  // where you grab, so the edges don't fling. Near the center this matches
  // grab-and-pull; everywhere else it stays uniform ("always feels like origin").
  // The pointer delta (device px) is converted to world units at the focus
  // scale, independent of the projection's wildly-varying local scale (§7.6).
  let panning = false;
  let lastOx = 0;
  let lastOy = 0;
  canvas.addEventListener('pointerdown', (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore: capture is a best-effort convenience (and absent for synthetic events).
    }
    panning = true;
    gliding = false;
    [lastOx, lastOy] = offsetPx(e.clientX, e.clientY);
    log.input.debug('pan:start', {
      pointerId: e.pointerId,
      client: { x: e.clientX, y: e.clientY },
      focus: { x: cam.focusX, y: cam.focusY },
      zoom: cam.zoom,
    });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!panning) {
      return;
    }
    const [ox, oy] = offsetPx(e.clientX, e.clientY);
    const dWorldX = (ox - lastOx) / cam.zoom;
    const dWorldY = (oy - lastOy) / cam.zoom;
    cam.focusX -= dWorldX;
    cam.focusY -= dWorldY;
    lastOx = ox;
    lastOy = oy;
    syncSprings();
    markDirty();
    log.input.silly('pan:move', {
      client: { x: e.clientX, y: e.clientY },
      dWorld: { x: dWorldX, y: dWorldY },
      focus: { x: cam.focusX, y: cam.focusY },
    });
  });
  const endPan = (e: PointerEvent) => {
    if (!panning) {
      return;
    }
    panning = false;
    log.input.debug('pan:end', { pointerId: e.pointerId, focus: { x: cam.focusX, y: cam.focusY } });
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore: nothing to release for synthetic/uncaptured pointers.
    }
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);

  // --- Zoom about the cursor: keep that world point fixed (§7.6). ---
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      gliding = false;
      const zoomBefore = cam.zoom;
      const [wx, wy] = worldAt(e.clientX, e.clientY);
      cam.zoom = clampZoom(cam.zoom * Math.exp(-e.deltaY * CAMERA.wheelSensitivity));
      const [ox, oy] = offsetPx(e.clientX, e.clientY);
      cam.focusX = wx - unprojectAxis(ox, canvas.width / 2, cam.zoom);
      cam.focusY = wy - unprojectAxis(oy, canvas.height / 2, cam.zoom);
      syncSprings();
      markDirty();
      log.input.debug('zoom', {
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        client: { x: e.clientX, y: e.clientY },
        worldUnderCursor: { x: wx, y: wy },
        zoomBefore,
        zoomAfter: cam.zoom,
        focus: { x: cam.focusX, y: cam.focusY },
      });
    },
    { passive: false },
  );

  // --- Focus glide: spring the focus to the double-clicked world point (§7.6). ---
  canvas.addEventListener('dblclick', (e) => {
    [targetX, targetY] = worldAt(e.clientX, e.clientY);
    gliding = true;
    log.glide.debug('glide:start', {
      client: { x: e.clientX, y: e.clientY },
      from: { x: cam.focusX, y: cam.focusY },
      target: { x: targetX, y: targetY },
    });
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
    log.glide.silly('glide:step', {
      dt,
      focus: { x: cam.focusX, y: cam.focusY },
      target: { x: targetX, y: targetY },
    });
    if (!movingX && !movingY) {
      gliding = false;
      log.glide.debug('glide:end', { focus: { x: cam.focusX, y: cam.focusY } });
    }
  }

  return { tick };
}
