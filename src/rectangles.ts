import { d, std, tgpu, type TgpuUniform } from 'typegpu';
import { CameraStruct } from './camera';
import { GRID } from './tunables';

/** A rectangle = a block of grid cells (integer indices, inclusive). It's the
 * grid, shown a certain way: geometry is pure lattice; Φ warps it like everything. */
export type Rect = { id: number; x0: number; y0: number; x1: number; y1: number };

/** Max rectangles held in the storage buffer (v2; grows later if needed). */
const CAP = 256;

/** Per-rectangle GPU record: world-space corners + flags (`.x` bit0 = selected). */
const RectGPU = d.struct({ min: d.vec2f, max: d.vec2f, flags: d.f32 });

// Appearance (translucent fill + crisp outline; direction-tint shows through).
const FILL_ALPHA = 0.1;
const OUTLINE_ALPHA = 0.7;
const OUTLINE_PX = 1.5;
const SELECTED_FILL_ALPHA = 0.22;

type Root = Awaited<ReturnType<typeof tgpu.init>>;

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
 * forward Φ (so they foreshorten and align with the grid). Create/delete only
 * for v2 (Architecture §9, §8.2).
 */
export function createRectangles(opts: {
  root: Root;
  camera: TgpuUniform<typeof CameraStruct>;
  format: GPUTextureFormat;
}) {
  const { root, camera, format } = opts;
  const rects: Rect[] = [];

  const buffer = root.createBuffer(d.arrayOf(RectGPU, CAP)).$usage('storage');
  const store = buffer.as('readonly');

  /** Write the active rectangles into the storage buffer (only on create/delete). */
  function sync(selectedId: number | null): void {
    const g = GRID.spacing;
    const data = Array.from({ length: CAP }, (_unused, i) => {
      const r = rects[i];
      if (!r) {
        return { min: d.vec2f(0, 0), max: d.vec2f(0, 0), flags: 0 };
      }
      return {
        min: d.vec2f(r.x0 * g, r.y0 * g),
        max: d.vec2f((r.x1 + 1) * g, (r.y1 + 1) * g),
        flags: r.id === selectedId ? 1 : 0,
      };
    });
    buffer.write(data);
  }

  const vertex = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { pos: d.builtin.position, uv: d.vec2f, sel: d.f32 },
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
    return { pos: d.vec4f(clipX, clipY, 0, 1), uv: corner, sel: r.flags };
  });

  const fragment = tgpu.fragmentFn({
    in: { uv: d.vec2f, sel: d.f32 },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    // Distance to the nearest quad edge, in uv units → px via fwidth.
    const edge = std.min(
      std.min(input.uv.x, d.f32(1) - input.uv.x),
      std.min(input.uv.y, d.f32(1) - input.uv.y),
    );
    const w = std.fwidth(edge);
    const outline = d.f32(1) - std.smoothstep(d.f32(0), w * OUTLINE_PX, edge);
    const fillA = std.select(d.f32(FILL_ALPHA), d.f32(SELECTED_FILL_ALPHA), input.sel > 0.5);
    const a = std.max(fillA, outline * OUTLINE_ALPHA);
    // Premultiplied white (matches the 'premultiplied' canvas + over blend).
    return d.vec4f(a, a, a, a);
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

  return {
    pipeline,
    rects,
    count: (): number => rects.length,
    /** Temporary: seed a couple of rectangles to verify rendering (step 2). */
    seedTest(): void {
      rects.push(
        { id: 1, x0: 0, y0: 0, x1: 2, y1: 1 },
        { id: 2, x0: -3, y0: -2, x1: -2, y1: -1 },
        { id: 3, x0: 1, y0: -3, x1: 4, y1: -3 },
      );
      sync(null);
    },
  };
}
