import { d, std, tgpu, type TgpuUniform } from 'typegpu';
import { CameraStruct } from './camera';
import type { CameraState, UiState } from './interactions';
import { log } from './logger';
import { worldAt } from './pointer';
import { GRID } from './tunables';

/** A rectangle = a block of grid cells (integer indices, inclusive on both ends).
 * It's the grid, shown a certain way: geometry is pure lattice; Φ warps it too. */
export type Rect = { id: number; x0: number; y0: number; x1: number; y1: number };

/** An in-progress rubber-band candidate (cell AABB) + whether it may be committed. */
type Preview = { x0: number; y0: number; x1: number; y1: number; valid: boolean };

/** Max rectangles + preview held in the storage buffer (v2; grows later if needed). */
const CAP = 256;

/** Per-rectangle GPU record: world-space corners + a discrete state flag.
 * flags: 0 = normal, 1 = selected, 2 = preview-valid, 3 = preview-invalid. */
const RectGPU = d.struct({ min: d.vec2f, max: d.vec2f, flags: d.f32 });

// Appearance (translucent fill + crisp outline; direction-tint shows through).
const FILL_ALPHA = 0.1;
const SELECTED_FILL_ALPHA = 0.22;
const PREVIEW_FILL_ALPHA = 0.16;
const OUTLINE_ALPHA = 0.7;
const PREVIEW_OUTLINE_BOOST = 0.25;
const SELECTED_OUTLINE_BOOST = 0.3;
const OUTLINE_PX = 1.5;

type Root = Awaited<ReturnType<typeof tgpu.init>>;

/** An axis-aligned cell range (inclusive), independent of a rectangle's identity. */
type CellAABB = { x0: number; y0: number; x1: number; y1: number };

/** Do two inclusive integer cell-AABBs share a cell? (Adjacency/touching → false.) */
function overlaps(a: CellAABB, b: CellAABB): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/**
 * Forward Φ tail (world→clip), one axis — the exact inverse of the grid's
 * `expandTail`, so a rectangle's cell-aligned edges land precisely on the
 * gridlines. Overflow-safe (rational never overflows; tanh input clamped).
 */
function squashTail(pp: number, mode: number): number {
  'use gpu';
  if (mode > 1.5) {
    return (2 / Math.PI) * std.atan((Math.PI / 2) * pp);
  }
  if (mode > 0.5) {
    return std.tanh(std.clamp(pp, d.f32(-30), d.f32(30)));
  }
  return pp / (1 + std.abs(pp));
}

/**
 * Rectangles on the grid: a CPU array of integer cell-AABBs mirrored into a GPU
 * storage buffer, drawn as instanced quads whose corners are projected by the
 * forward Φ (so they foreshorten and align with the grid). In the Draw tool a
 * click-drag rubber-bands a cell-snapped rectangle with a live valid/invalid
 * preview; overlap is forbidden (touching edges are separate cells, so allowed).
 * Create only for v2 (select + delete land in step 4). Architecture §8.2, §9.
 */
export function createRectangles(opts: {
  root: Root;
  camera: TgpuUniform<typeof CameraStruct>;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  cam: CameraState;
  ui: UiState;
  markDirty: () => void;
}) {
  const { root, camera, format, canvas, cam, ui, markDirty } = opts;
  const rects: Rect[] = [];
  let selectedId: number | null = null;
  let nextId = 1;

  // Rubber-band draw state.
  let dragging = false;
  let anchor: [number, number] | null = null;
  let preview: Preview | null = null;

  const buffer = root.createBuffer(d.arrayOf(RectGPU, CAP)).$usage('storage');
  const store = buffer.as('readonly');

  /** Number of instances to draw = committed rects + the live preview (if any). */
  const count = (): number => Math.min(rects.length + (preview ? 1 : 0), CAP);

  /** Mirror the active rectangles (+ preview) into the storage buffer. Only called
   * on create/delete/select and during an active drag — never per frame. */
  function sync(): void {
    const g = GRID.spacing;
    const data = Array.from({ length: CAP }, (_unused, i) => {
      if (i < rects.length) {
        const r = rects[i];
        return {
          min: d.vec2f(r.x0 * g, r.y0 * g),
          max: d.vec2f((r.x1 + 1) * g, (r.y1 + 1) * g),
          flags: r.id === selectedId ? 1 : 0,
        };
      }
      if (preview && i === rects.length) {
        return {
          min: d.vec2f(preview.x0 * g, preview.y0 * g),
          max: d.vec2f((preview.x1 + 1) * g, (preview.y1 + 1) * g),
          flags: preview.valid ? 2 : 3,
        };
      }
      return { min: d.vec2f(0, 0), max: d.vec2f(0, 0), flags: 0 };
    });
    buffer.write(data);
  }

  /** Integer cell index under the cursor (floor of world / spacing). */
  function cellAt(clientX: number, clientY: number): [number, number] {
    const [wx, wy] = worldAt(canvas, cam, clientX, clientY);
    return [Math.floor(wx / GRID.spacing), Math.floor(wy / GRID.spacing)];
  }

  /** Do two inclusive integer cell-AABBs share a cell? (Adjacency/touching → false.) */
  function overlapsAny(cand: CellAABB): boolean {
    return rects.some((r) => overlaps(cand, r));
  }

  function candidate(a: [number, number], b: [number, number]): Preview {
    const c: CellAABB = {
      x0: Math.min(a[0], b[0]),
      y0: Math.min(a[1], b[1]),
      x1: Math.max(a[0], b[0]),
      y1: Math.max(a[1], b[1]),
    };
    return { ...c, valid: rects.length < CAP && !overlapsAny(c) };
  }

  /** The rectangle whose cell-AABB contains the cursor's cell (at most one — no
   * overlaps), or null. Linear scan in cell space (add flatbush if counts grow). */
  function pickAt(clientX: number, clientY: number): Rect | null {
    const [cx, cy] = cellAt(clientX, clientY);
    return rects.find((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) ?? null;
  }

  function deleteById(id: number): void {
    const i = rects.findIndex((r) => r.id === id);
    if (i < 0) {
      return;
    }
    rects.splice(i, 1);
    if (selectedId === id) {
      selectedId = null;
    }
    sync();
    markDirty();
  }

  // --- Pointer handling. Draw tool = rubber-band create; Select tool = click to
  //     select (a drag pans, handled in interactions.ts); right-click = delete under
  //     the cursor (any tool). A press that moves past CLICK_SLOP is a drag, not a click.
  const CLICK_SLOP = 4; // client px
  let selDown: [number, number] | null = null;
  let selMoved = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) {
      return; // left button only; right-click is handled by contextmenu
    }
    if (ui.tool === 'draw') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Best-effort capture; ignore for synthetic/uncaptured pointers.
      }
      dragging = true;
      anchor = cellAt(e.clientX, e.clientY);
      preview = candidate(anchor, anchor);
      sync();
      markDirty();
      log.input.debug('rect:draw:start', { anchorCell: anchor, valid: preview.valid });
      return;
    }
    // Select tool: remember the press; a click (no drag) selects on release.
    selDown = [e.clientX, e.clientY];
    selMoved = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging && anchor) {
      preview = candidate(anchor, cellAt(e.clientX, e.clientY));
      sync();
      markDirty();
      log.input.silly('rect:draw:move', { preview });
      return;
    }
    if (selDown && !selMoved) {
      if (Math.hypot(e.clientX - selDown[0], e.clientY - selDown[1]) > CLICK_SLOP) {
        selMoved = true; // became a pan
      }
    }
  });

  const onPointerEnd = (e: PointerEvent): void => {
    if (dragging) {
      dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Nothing to release for synthetic/uncaptured pointers.
      }
      if (preview?.valid) {
        const r: Rect = {
          id: nextId,
          x0: preview.x0,
          y0: preview.y0,
          x1: preview.x1,
          y1: preview.y1,
        };
        nextId += 1;
        rects.push(r);
        log.input.debug('rect:create', { rect: r, total: rects.length });
      } else {
        log.input.debug('rect:draw:reject', { reason: preview ? 'overlap' : 'none' });
      }
      preview = null;
      anchor = null;
      sync();
      markDirty();
      return;
    }
    if (selDown) {
      if (!selMoved) {
        // A click (not a pan): select the rectangle under the cursor, or deselect.
        const hit = pickAt(e.clientX, e.clientY);
        const next = hit ? hit.id : null;
        if (next !== selectedId) {
          selectedId = next;
          sync();
          markDirty();
        }
        log.input.debug('rect:select', { selectedId });
      }
      selDown = null;
      selMoved = false;
    }
  };
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);

  // Right-click: immediate delete of the rectangle under the cursor (no menu).
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) {
      deleteById(hit.id);
      log.input.debug('rect:delete:context', { id: hit.id, total: rects.length });
    }
  });

  window.addEventListener('keydown', (e) => {
    // Esc cancels an in-progress rubber-band (no rectangle created).
    if (e.key === 'Escape' && dragging) {
      dragging = false;
      preview = null;
      anchor = null;
      sync();
      markDirty();
      log.input.debug('rect:draw:esc');
      return;
    }
    // Delete/Backspace removes the selected rectangle (ignored while typing in the panel).
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (selectedId !== null) {
        e.preventDefault();
        const id = selectedId;
        deleteById(id);
        log.input.debug('rect:delete:key', { id, total: rects.length });
      }
    }
  });

  const vertex = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { pos: d.builtin.position, uv: d.vec2f, flags: d.f32 },
  })((input) => {
    'use gpu';
    const r = store.$[input.iid];
    // Triangle-strip quad corner from vertex index, via parity/half (no ==):
    // vid 0→(0,0) 1→(1,0) 2→(0,1) 3→(1,1).
    const v = d.f32(input.vid);
    const cornerY = std.floor(v / 2); // 0,0,1,1
    const cornerX = v - 2 * cornerY; // 0,1,0,1
    const corner = d.vec2f(cornerX, cornerY);
    const worldCorner = std.mix(r.min, r.max, corner);
    const half = camera.$.resolution * 0.5;
    const camDelta = worldCorner - camera.$.focus;
    const clipX = squashTail((camera.$.zoom * camDelta.x) / half.x, camera.$.tailMode);
    const clipY = squashTail((camera.$.zoom * camDelta.y) / half.y, camera.$.tailMode);
    return { pos: d.vec4f(clipX, clipY, 0, 1), uv: corner, flags: r.flags };
  });

  const fragment = tgpu.fragmentFn({
    in: { uv: d.vec2f, flags: d.f32 },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const flags = input.flags;
    // Decode discrete state without == (thresholds on the flag value).
    const isSelected =
      std.select(d.f32(0), d.f32(1), flags > 0.5) - std.select(d.f32(0), d.f32(1), flags > 1.5);
    const isPreview = std.select(d.f32(0), d.f32(1), flags > 1.5);
    const isInvalid = std.select(d.f32(0), d.f32(1), flags > 2.5);

    // Distance to the nearest quad edge, in uv units → px via fwidth.
    const edge = std.min(
      std.min(input.uv.x, d.f32(1) - input.uv.x),
      std.min(input.uv.y, d.f32(1) - input.uv.y),
    );
    const w = std.fwidth(edge);
    const outline = d.f32(1) - std.smoothstep(d.f32(0), w * OUTLINE_PX, edge);

    const fillA =
      d.f32(FILL_ALPHA) * (d.f32(1) - isSelected) * (d.f32(1) - isPreview) +
      d.f32(SELECTED_FILL_ALPHA) * isSelected +
      d.f32(PREVIEW_FILL_ALPHA) * isPreview;
    const outlineA =
      d.f32(OUTLINE_ALPHA) +
      isPreview * d.f32(PREVIEW_OUTLINE_BOOST) +
      isSelected * d.f32(SELECTED_OUTLINE_BOOST);
    const a = std.max(fillA, outline * outlineA);

    // White normally; red when the preview would overlap (invalid).
    const color = std.mix(d.vec3f(1, 1, 1), d.vec3f(1, 0.28, 0.28), isInvalid);
    // Premultiplied (matches the 'premultiplied' canvas + over blend).
    return d.vec4f(color * a, a);
  });

  const pipeline = root.createRenderPipeline({
    vertex,
    fragment,
    primitive: { topology: 'triangle-strip' },
    targets: {
      format,
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    },
  });

  return { pipeline, rects, count };
}
