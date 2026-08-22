import { unprojectAxis } from './projection';

/** Minimal camera shape needed to map screen → world (structural; no import cycle). */
type Cam = { focusX: number; focusY: number; zoom: number };

/** Pointer offset from the screen center, in device px, Y-up (matches the shader). */
export function offsetPx(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const ox = (clientX - rect.left) * scaleX - canvas.width / 2;
  const oy = canvas.height / 2 - (clientY - rect.top) * scaleY;
  return [ox, oy];
}

/** World point under the cursor via Φ⁻¹, at the current camera (Architecture §7.3). */
export function worldAt(
  canvas: HTMLCanvasElement,
  cam: Cam,
  clientX: number,
  clientY: number,
): [number, number] {
  const [ox, oy] = offsetPx(canvas, clientX, clientY);
  return [
    cam.focusX + unprojectAxis(ox, canvas.width / 2, cam.zoom),
    cam.focusY + unprojectAxis(oy, canvas.height / 2, cam.zoom),
  ];
}
