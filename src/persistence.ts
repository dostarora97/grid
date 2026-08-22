/*
 * Scene persistence — save/load the document (rectangles + camera view) to
 * localStorage. Rectangles are tiny (5 ints each), so localStorage is ample;
 * the parse/serialize boundary is a versioned JSON envelope so we can migrate
 * or swap to IndexedDB later without touching call sites. Saves are debounced;
 * `flushScene()` writes immediately (call it on page-hide). Architecture §9/§16.
 */

/** A persisted rectangle (integer cell-AABB), mirror of rectangles.ts `Rect`. */
export type SceneRect = { id: number; x0: number; y0: number; x1: number; y1: number };

/** Persisted camera view — where the user left off. */
export type SceneView = { focusX: number; focusY: number; zoom: number };

/** The full persisted document. */
export type Scene = { rects: SceneRect[]; nextId: number; view?: SceneView };

const KEY = 'grid.scene';
const VERSION = 1;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isRect(x: unknown): x is SceneRect {
  if (typeof x !== 'object' || x === null) {
    return false;
  }
  const r = x as Record<string, unknown>;
  return isNum(r.id) && isNum(r.x0) && isNum(r.y0) && isNum(r.x1) && isNum(r.y1);
}

function isView(x: unknown): x is SceneView {
  if (typeof x !== 'object' || x === null) {
    return false;
  }
  const v = x as Record<string, unknown>;
  return isNum(v.focusX) && isNum(v.focusY) && isNum(v.zoom);
}

/**
 * Parse a persisted envelope string into a Scene, or null if absent/corrupt/of
 * an unknown version. Pure (no I/O) so it's unit-tested; tolerant of partial
 * corruption — bad rectangles are dropped, a bad view is ignored.
 */
export function parseScene(raw: string | null): Scene | null {
  if (!raw) {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) {
    return null;
  }
  const o = obj as Record<string, unknown>;
  if (o.version !== VERSION || !Array.isArray(o.rects)) {
    return null;
  }
  const rects = (o.rects as unknown[]).filter(isRect);
  const nextId = isNum(o.nextId) ? o.nextId : rects.reduce((max, r) => Math.max(max, r.id + 1), 1);
  const view = isView(o.view) ? o.view : undefined;
  return view ? { rects, nextId, view } : { rects, nextId };
}

/** Load the saved scene from localStorage (null if none / unavailable / corrupt). */
export function loadScene(): Scene | null {
  try {
    return parseScene(localStorage.getItem(KEY));
  } catch {
    return null; // localStorage unavailable (private mode, disabled, SSR)
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Scene | null = null;

function write(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending) {
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...pending }));
  } catch {
    // Ignore: quota exceeded / unavailable. Persistence is best-effort.
  }
  pending = null;
}

/** Queue a debounced save (~300ms) of the latest scene. */
export function saveScene(scene: Scene): void {
  pending = scene;
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(write, 300);
}

/** Write any pending save immediately (call on page-hide / before unload). */
export function flushScene(): void {
  write();
}

/** Delete the saved scene and cancel any pending write. */
export function clearScene(): void {
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore: unavailable.
  }
}
