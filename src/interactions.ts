import { clampZoom, unprojectAxis } from './projection';
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

  // --- Pan: keep the grabbed world point glued under the cursor (§7.6). ---
  let panning = false;
  let grabX = 0;
  let grabY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore: capture is a best-effort convenience (and absent for synthetic events).
    }
    panning = true;
    gliding = false;
    [grabX, grabY] = worldAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!panning) {
      return;
    }
    const [ox, oy] = offsetPx(e.clientX, e.clientY);
    cam.focusX = grabX - unprojectAxis(ox, canvas.width / 2, cam.zoom);
    cam.focusY = grabY - unprojectAxis(oy, canvas.height / 2, cam.zoom);
    syncSprings();
    markDirty();
  });
  const endPan = (e: PointerEvent) => {
    if (!panning) {
      return;
    }
    panning = false;
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

  // --- Focus glide: spring the focus to the double-clicked world point (§7.6). ---
  canvas.addEventListener('dblclick', (e) => {
    [targetX, targetY] = worldAt(e.clientX, e.clientY);
    gliding = true;
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
    }
  }

  return { tick };
}
