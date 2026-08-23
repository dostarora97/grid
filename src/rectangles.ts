import { d, std, tgpu, type TgpuUniform } from 'typegpu';
import { CameraStruct } from './camera';
import type { CameraState } from './interactions';
import { log } from './logger';
import { worldAt } from './pointer';
import { GRID } from './tunables';

/** A media tile = a block of grid cells (integer indices, inclusive on both ends),
 * filled with an image/gif. Geometry is pure lattice; Φ warps it like the grid.
 * `tex` is a runtime-only media layer index (−1/undefined = none; not persisted). */
export type Rect = { id: number; x0: number; y0: number; x1: number; y1: number; tex?: number };

/** Max tiles (+ pending) held in the storage buffer (grows later if needed). */
const CAP = 256;

/** Media texture array — per-node images/gifs sampled onto the quad. Square layers
 * (aspect handled by the node's cell block); modest count/size to bound VRAM. */
const MEDIA_LAYERS = 64;
const MEDIA_SIZE = 256;

/** Per-tile GPU record: world-space corners + a state flag (0 = committed,
 * 2 = pending placement) + a media texture-array layer (`tex`, −1 = none). */
const RectGPU = d.struct({ min: d.vec2f, max: d.vec2f, flags: d.f32, tex: d.f32 });

// Appearance (translucent fill + crisp outline; direction-tint shows through).
const FILL_ALPHA = 0.1;
const PREVIEW_FILL_ALPHA = 0.16;
const OUTLINE_ALPHA = 0.7;
const PREVIEW_OUTLINE_BOOST = 0.25;
const GHOST_OUTLINE_ALPHA = 0.4;
const OUTLINE_PX = 1.5;

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
 * Derivative of `squashTail` at `pp` — the local scale factor of the forward Φ
 * (before the ×zoom). Used for isotropic node rendering: a rectangle is drawn at a
 * single scale (√ of the two axis scales at its center) so it keeps true
 * proportions instead of foreshortening per-corner.
 */
function squashDeriv(pp: number, mode: number): number {
  'use gpu';
  if (mode > 1.5) {
    const a = (Math.PI / 2) * pp; // atan tail: 1/(1+((π/2)p)²)
    return 1 / (1 + a * a);
  }
  if (mode > 0.5) {
    const t = std.tanh(std.clamp(pp, d.f32(-30), d.f32(30))); // tanh: sech² = 1−tanh²
    return 1 - t * t;
  }
  const den = 1 + std.abs(pp); // rational: 1/(1+|p|)²
  return 1 / (den * den);
}

/**
 * Media tiles on the grid: a CPU array of integer cell-AABBs (each filled with an
 * image/gif) mirrored into a GPU storage buffer, drawn as instanced quads whose
 * corners are projected by the forward Φ (so they foreshorten and align with the
 * grid, or stay true-proportion in isotropic mode). Exposes a placement API
 * (attach → position → commit) that fly.ts and interactions.ts drive, plus delete
 * and persistence. Architecture §8.2, §9, §16.
 */
export function createRectangles(opts: {
  root: Root;
  camera: TgpuUniform<typeof CameraStruct>;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  cam: CameraState;
  markDirty: () => void;
  /** Called after the rectangle set changes (create/delete/clear) — for persistence. */
  onChange?: () => void;
}) {
  const { root, camera, format, canvas, cam, markDirty, onChange } = opts;
  const rects: Rect[] = [];
  let nextId = 1;

  // Media placement: a pending tile carried before commit. Its center is a
  // CONTINUOUS world point (cx,cy) — fly → the focus, grab → the cursor — so it
  // glides smoothly with the crosshair/cursor and only snaps to a cell on commit.
  let pending: { cw: number; ch: number; cx: number; cy: number; layer: number } | null = null;
  // Snap-target ghost: shown while carrying only when movement is "stable" (fly.ts
  // gates this via hysteresis on speed) so it doesn't flicker cell-to-cell.
  let ghostVisible = false;

  const buffer = root.createBuffer(d.arrayOf(RectGPU, CAP)).$usage('storage');
  const store = buffer.as('readonly');

  // Media: a texture array (one layer per textured node) + sampler, bound to the
  // rect pipeline so the fragment can sample a node's image. Layers are allocated
  // round-robin; the node's `tex` holds its layer (−1 = untextured → flat fill).
  const mediaTex = root
    .createTexture({ size: [MEDIA_SIZE, MEDIA_SIZE, MEDIA_LAYERS], format: 'rgba8unorm' })
    .$usage('sampled', 'render');
  const mediaView = mediaTex.createView(d.texture2dArray(d.f32));
  const mediaSampler = root.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const mediaLayout = tgpu.bindGroupLayout({
    tex: { texture: d.texture2dArray(d.f32) },
    samp: { sampler: 'filtering' },
  });
  const mediaBindGroup = root.createBindGroup(mediaLayout, { tex: mediaView, samp: mediaSampler });
  let nextLayer = 0;

  /** Reserve the next media-array layer (round-robin). */
  function allocLayer(): number {
    const layer = nextLayer % MEDIA_LAYERS;
    nextLayer += 1;
    return layer;
  }

  /** Copy an image source into a specific media-array layer. */
  function writeLayer(layer: number, source: GPUCopyExternalImageSource): void {
    root.device.queue.copyExternalImageToTexture(
      { source, flipY: true },
      { texture: root.unwrap(mediaTex), origin: [0, 0, layer] },
      [MEDIA_SIZE, MEDIA_SIZE],
    );
  }

  /** Load an image URL (cross-origin OK) into a square canvas (null on failure). */
  async function loadToCanvas(url: string): Promise<OffscreenCanvas | null> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = new Promise<void>((resolve, reject) => {
      img.addEventListener('load', () => {
        resolve();
      });
      img.addEventListener('error', () => {
        reject(new Error('image load failed'));
      });
    });
    img.src = url;
    try {
      await done;
    } catch {
      log.input.warn('rect:media:load-failed', { url });
      return null;
    }
    const cv = new OffscreenCanvas(MEDIA_SIZE, MEDIA_SIZE);
    const g = cv.getContext('2d');
    if (!g) {
      return null;
    }
    g.drawImage(img, 0, 0, MEDIA_SIZE, MEDIA_SIZE); // stretch to square; node aspect corrects it
    return cv;
  }

  /** Upload an image source to a node's media layer and show it. */
  function setImage(id: number, source: GPUCopyExternalImageSource): void {
    const layer = allocLayer();
    writeLayer(layer, source);
    const r = rects.find((x) => x.id === id);
    if (r) {
      r.tex = layer;
      sync();
      markDirty();
    }
  }

  /** Load an image URL and show it on a node. */
  async function setImageFromUrl(id: number, url: string): Promise<void> {
    const cv = await loadToCanvas(url);
    if (cv) {
      setImage(id, cv);
    }
  }

  // --- Media placement: attach a tile, position it by the active mode's center
  //     cell (fly → screen center; grab → cursor), then commit. Overlap allowed. ---

  /** Begin carrying a `cw×ch` tile, centered on the current focus (world). */
  function beginPlacement(cw: number, ch: number): void {
    pending = { cw, ch, cx: cam.focusX, cy: cam.focusY, layer: allocLayer() };
    sync();
    markDirty();
  }

  /** Move the carried tile's center to a continuous world point (no snapping). */
  function setPlacementCenterWorld(wx: number, wy: number): void {
    if (!pending || (wx === pending.cx && wy === pending.cy)) {
      return;
    }
    pending.cx = wx;
    pending.cy = wy;
    sync();
    markDirty();
  }

  /** Load an image URL into the pending tile's layer (shows it as it slides). */
  async function setPendingImageFromUrl(url: string): Promise<void> {
    if (!pending) {
      return;
    }
    const layer = pending.layer;
    const cv = await loadToCanvas(url);
    if (cv && pending && pending.layer === layer) {
      writeLayer(layer, cv);
      sync();
      markDirty();
    }
  }

  /** Commit the carried tile to a real media node, snapped to the nearest cell block. */
  function commitPlacement(): number | null {
    if (!pending) {
      return null;
    }
    const g = GRID.spacing;
    const x0 = Math.round(pending.cx / g - pending.cw / 2);
    const y0 = Math.round(pending.cy / g - pending.ch / 2);
    const r: Rect = {
      id: nextId,
      x0,
      y0,
      x1: x0 + pending.cw - 1,
      y1: y0 + pending.ch - 1,
      tex: pending.layer,
    };
    nextId += 1;
    rects.push(r);
    pending = null;
    ghostVisible = false;
    sync();
    markDirty();
    onChange?.();
    log.input.debug('rect:media:placed', { rect: r });
    return r.id;
  }

  /** Discard the pending placement without creating anything. */
  function cancelPlacement(): void {
    if (!pending) {
      return;
    }
    pending = null;
    ghostVisible = false;
    sync();
    markDirty();
  }

  /** Whether a placement is in progress. */
  const isPlacing = (): boolean => pending !== null;

  /** Show the snap-target ghost (fly.ts toggles this via a hysteresis "stable" gate). */
  function setGhostVisible(v: boolean): void {
    if (v === ghostVisible) {
      return;
    }
    ghostVisible = v;
    sync();
    markDirty();
  }

  /** Instances to draw = committed rects + pending tile + snap-target ghost. */
  const count = (): number =>
    Math.min(rects.length + (pending ? 1 : 0) + (pending && ghostVisible ? 1 : 0), CAP);

  /** Mirror the committed rectangles (+ pending tile, + snap-target ghost) into the
   * storage buffer. Called on change and while a placement tile is being positioned. */
  function sync(): void {
    const g = GRID.spacing;
    const extras: { min: d.v2f; max: d.v2f; flags: number; tex: number }[] = [];
    if (pending) {
      const hw = (pending.cw * g) / 2;
      const hh = (pending.ch * g) / 2;
      extras.push({
        min: d.vec2f(pending.cx - hw, pending.cy - hh),
        max: d.vec2f(pending.cx + hw, pending.cy + hh),
        flags: 2, // brighter outline; textured shows the image
        tex: pending.layer,
      });
      if (ghostVisible) {
        // The snapped cell-block where the pending tile will land (a faint outline).
        const x0 = Math.round(pending.cx / g - pending.cw / 2);
        const y0 = Math.round(pending.cy / g - pending.ch / 2);
        extras.push({
          min: d.vec2f(x0 * g, y0 * g),
          max: d.vec2f((x0 + pending.cw) * g, (y0 + pending.ch) * g),
          flags: 5, // ghost: faint hollow outline, no fill, no texture
          tex: -1,
        });
      }
    }
    const data = Array.from({ length: CAP }, (_unused, i) => {
      if (i < rects.length) {
        const r = rects[i];
        return {
          min: d.vec2f(r.x0 * g, r.y0 * g),
          max: d.vec2f((r.x1 + 1) * g, (r.y1 + 1) * g),
          flags: 0,
          tex: r.tex ?? -1,
        };
      }
      return (
        extras[i - rects.length] ?? { min: d.vec2f(0, 0), max: d.vec2f(0, 0), flags: 0, tex: -1 }
      );
    });
    buffer.write(data);
  }

  /** Integer cell index under the cursor (floor of world / spacing). */
  function cellAt(clientX: number, clientY: number): [number, number] {
    const [wx, wy] = worldAt(canvas, cam, clientX, clientY);
    return [Math.floor(wx / GRID.spacing), Math.floor(wy / GRID.spacing)];
  }

  function deleteById(id: number): void {
    const i = rects.findIndex((r) => r.id === id);
    if (i < 0) {
      return;
    }
    rects.splice(i, 1);
    sync();
    markDirty();
    onChange?.();
  }

  /** The cell at the screen center — the focus maps exactly to the center pixel. */
  function centerCell(): [number, number] {
    return [Math.floor(cam.focusX / GRID.spacing), Math.floor(cam.focusY / GRID.spacing)];
  }

  /** Delete the media tile whose cell-block contains cell (cx, cy), if any. */
  function deleteAt(cx: number, cy: number): void {
    const hit = rects.find((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
    if (hit) {
      deleteById(hit.id);
      log.input.debug('rect:delete', { id: hit.id, total: rects.length });
    }
  }

  /** Delete the tile under the screen center (fly-mode right-click). */
  function deleteAtCenter(): void {
    const [cx, cy] = centerCell();
    deleteAt(cx, cy);
  }

  // --- Persistence (see persistence.ts). ---

  /** Snapshot the rectangle set for saving. */
  function serialize(): { rects: Rect[]; nextId: number } {
    return { rects: rects.map((r) => ({ ...r })), nextId };
  }

  /** Replace the rectangle set from a saved snapshot (used on boot). */
  function load(loaded: Rect[], id: number): void {
    rects.length = 0;
    for (const r of loaded) {
      rects.push({ ...r });
    }
    nextId = Math.max(
      id,
      rects.reduce((m, r) => Math.max(m, r.id + 1), 1),
    );
    pending = null;
    ghostVisible = false;
    sync();
    markDirty();
  }

  /** Remove all rectangles (and notify onChange so the empty state persists). */
  function clear(): void {
    rects.length = 0;
    nextId = 1;
    pending = null;
    ghostVisible = false;
    sync();
    markDirty();
    onChange?.();
  }

  /** Create a rectangle directly (seeding / programmatic); returns its id. */
  function addRect(x0: number, y0: number, x1: number, y1: number): number {
    const r: Rect = { id: nextId, x0, y0, x1, y1 };
    nextId += 1;
    rects.push(r);
    sync();
    markDirty();
    onChange?.();
    return r.id;
  }

  const vertex = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { pos: d.builtin.position, uv: d.vec2f, flags: d.f32, tex: d.f32 },
  })((input) => {
    'use gpu';
    const r = store.$[input.iid];
    // Triangle-strip quad corner from vertex index, via parity/half (no ==):
    // vid 0→(0,0) 1→(1,0) 2→(0,1) 3→(1,1).
    const v = d.f32(input.vid);
    const cornerY = std.floor(v / 2); // 0,0,1,1
    const cornerX = v - 2 * cornerY; // 0,1,0,1
    const corner = d.vec2f(cornerX, cornerY);
    const half = camera.$.resolution * 0.5;
    const mode = camera.$.tailMode;

    // Anisotropic: project each corner independently → foreshortens/stretches.
    const worldCorner = std.mix(r.min, r.max, corner);
    const camDelta = worldCorner - camera.$.focus;
    const clipAniso = d.vec2f(
      squashTail((camera.$.zoom * camDelta.x) / half.x, mode),
      squashTail((camera.$.zoom * camDelta.y) / half.y, mode),
    );

    // Isotropic: project the center, then offset corners by the world half-size
    // scaled by ONE local scale (√ of the two axis scales) → true proportions.
    const center = (r.min + r.max) * 0.5;
    const halfSize = (r.max - r.min) * 0.5;
    const uC = (camera.$.zoom * (center - camera.$.focus)) / half;
    const cc = d.vec2f(squashTail(uC.x, mode), squashTail(uC.y, mode));
    const sx = camera.$.zoom * squashDeriv(uC.x, mode);
    const sy = camera.$.zoom * squashDeriv(uC.y, mode);
    const s = std.sqrt(sx * sy);
    const rel = d.vec2f(cornerX * 2 - 1, cornerY * 2 - 1); // corner in {−1,1}
    const clipIso = cc + (rel * halfSize * s) / half;

    const clip = std.mix(clipAniso, clipIso, camera.$.isoMode);
    return { pos: d.vec4f(clip.x, clip.y, 0, 1), uv: corner, flags: r.flags, tex: r.tex };
  });

  const fragment = tgpu.fragmentFn({
    in: { uv: d.vec2f, flags: d.f32, tex: d.f32 },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    // flags: 0 = committed tile, 2 = pending placement, 5 = snap-target ghost.
    const isPreview =
      std.select(d.f32(0), d.f32(1), input.flags > 1.5) -
      std.select(d.f32(0), d.f32(1), input.flags > 2.5);
    const isGhost = std.select(d.f32(0), d.f32(1), input.flags > 4.5);

    // Distance to the nearest quad edge, in uv units → px via fwidth.
    const edge = std.min(
      std.min(input.uv.x, d.f32(1) - input.uv.x),
      std.min(input.uv.y, d.f32(1) - input.uv.y),
    );
    const w = std.fwidth(edge);
    const outline = d.f32(1) - std.smoothstep(d.f32(0), w * OUTLINE_PX, edge);

    // Ghost = faint hollow outline (no fill, no texture); else fill + outline.
    const fillA =
      std.mix(d.f32(FILL_ALPHA), d.f32(PREVIEW_FILL_ALPHA), isPreview) * (d.f32(1) - isGhost);
    const outlineA = std.mix(
      d.f32(OUTLINE_ALPHA) + isPreview * d.f32(PREVIEW_OUTLINE_BOOST),
      d.f32(GHOST_OUTLINE_ALPHA),
      isGhost,
    );
    const a = std.max(fillA, outline * outlineA);

    // Textured tiles: sample the media layer (uniform control flow — sample
    // unconditionally at a clamped layer, then blend in only when tex ≥ 0).
    const layer = input.tex;
    const hasTex = std.select(d.f32(0), d.f32(1), layer > d.f32(-0.5));
    const img = std.textureSample(
      mediaLayout.$.tex,
      mediaLayout.$.samp,
      input.uv,
      d.i32(std.max(layer, d.f32(0))),
    );
    const oA = outline * outlineA;
    const texA = std.max(img.w, oA); // image alpha, but always show the outline
    const texRGB = std.mix(img.xyz, d.vec3f(1, 1, 1), oA); // whiten at the outline

    const finalA = std.mix(a, texA, hasTex);
    const finalRGB = std.mix(d.vec3f(1, 1, 1), texRGB, hasTex);
    // Premultiplied (matches the 'premultiplied' canvas + over blend).
    return d.vec4f(finalRGB * finalA, finalA);
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

  /** The render pipeline with the media (texture array + sampler) bind group bound.
   * Caller adds the pass and draw: `withMedia().with(pass).draw(4, count())`. */
  function withMedia() {
    return pipeline.with(mediaLayout, mediaBindGroup);
  }

  return {
    pipeline,
    withMedia,
    rects,
    count,
    cellAt,
    centerCell,
    // Media:
    setImage,
    setImageFromUrl,
    addRect,
    // Media placement (fly.ts / interactions.ts drive these):
    beginPlacement,
    setPlacementCenterWorld,
    setPendingImageFromUrl,
    commitPlacement,
    cancelPlacement,
    isPlacing,
    setGhostVisible,
    // Delete:
    deleteAt,
    deleteAtCenter,
    // Persistence:
    serialize,
    load,
    clear,
  };
}
