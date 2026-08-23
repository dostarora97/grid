# PLAN.md — open questions, tasks, deferrals, roadmap

Working companion to `ARCHITECTURE.md` (the source of truth). This tracks what's
*not yet done*. Update alongside commits. Status as of change log **v0.6**.

---

## Status
v1 (projected grid + interactions) is **built, verified, committed** (DoD §14).
Post-v1 enhancements shipped: verbose logging/telemetry, camera-relative precision,
adaptive multi-level grid + edge fade, world-direction color tint, uniform pan,
live settings panel. **v2 (rectangles on the grid — create/select/delete) is built &
verified.** All pushed to `origin/main`.

---

## Open questions (design — undecided, kept open on purpose)
- **Grid look** — *intentionally open; exploring how it evolves.* Palette (keep the
  8-hue opponent tint vs. a simpler 2-color / single-hue scheme), whether to tint the
  **lines** too (currently field-only, lines white), tint strength/scale defaults.
- **Final tunable defaults** — fade start/end, tint strength/scale, number of levels,
  line alpha/width still carry first-guess values; bake once the feel is settled.
- **"How loud is infinity"** — now split across fade + tint; a taste call.
- **Off-screen origin** — should "home" be findable when the origin is squeezed to an
  edge (an edge indicator / minimap arrow)?

## Open tasks / debts
- **Logging** — default `minLevel` is now **DEBUG** (SILLY/TRACE firehose silenced but
  kept in code; `gridLog.settings.minLevel = 0` re-enables live). Still to do: gate to
  dev-only (`import.meta.env.DEV`) before any "production" use.
- **More tests** — only `projection.test.ts` (math) exists; spring + interaction logic
  are untested.
- **ARCHITECTURE.md** — spec sections carry inline "Built (v0.6)" notes + a full v0.6
  change log; body still reads as the v1 baseline by design. Deepen if it drifts more.

## Deferred (catalog — from v1 scope + discussions)
Grid affordances (§6.5): hover cell-highlight; coordinate/position readout (cursor +
focus world coords). Color: distinct X/Y axis hues; colored lines; tint presets /
color pickers / per-level opacity in the panel. Camera feel: pan inertia/momentum;
zoom-glide (spring the zoom); origin off-screen indicator. Projection: isotropic-mode
toggle (§16; Jacobian §7.4 ready). Grid enhancements (§16): snapping guides; coordinate
rulers along the frame. *(Adaptive `G` is effectively DONE via the multi-level grid.)*
Tooling: TypeGPU Runtime Inspector MCP (not wired). *(Persistence — scene
serialization — is now BUILT on the fly branch: see Experiments.)*

## Roadmap (next milestones — §16)
- **v2 — Rectangles on the grid** *(BUILT & verified):* click-drag a cell-snapped
  rectangle that warps with the grid. Introduced the node **storage buffer** (§9) and
  **instanced-quad** rendering with Φ in the vertex shader.
  - ✅ step 1 — tool modes (Select/Draw; `V`/`R` + panel buttons; cursor).
  - ✅ step 2 — rect data model + storage buffer + instanced-quad rendering (forward-Φ
    corners via `squashTail`, translucent premultiplied fill + fwidth-AA outline).
  - ✅ step 3 — rubber-band create: cell snap, live valid(white)/invalid(red) preview,
    1×1 empty-click, Esc cancel, no-overlap forbid (integer AABB test).
  - ✅ step 4 — select (click, brighter highlight; drag still pans) + delete (`Delete`/
    `Backspace` on the selected rect; right-click = immediate delete under the cursor).
  - *CPU picking is a linear scan in cell space (add `flatbush` if counts grow). Far-from-
    origin corner precision uses camera-relative projection in the vertex shader.*
  - *Deferred to v2+: move/resize, per-rect color, multi-select, auto-clamp-on-overlap,
    persistence (rects are in-memory, lost on reload), Option-B/hybrid input.*
- v3 — Links between nodes (tessellated along their length).
- v4 — Text & LOD (MSDF/bitmap fonts; degrade far nodes gracefully).
  - *Candidate (watch): **HTML-in-Canvas API*** (`copyElementImageToTexture`, WebGPU) to render real DOM/CSS text into a node texture we sample on the projected quad — a possible alternative to MSDF. Caveat: its interactive/accessible DOM sync uses an affine `DOMMatrix`, so it aligns only near the focus under our non-linear Φ; use render-only + our own CPU picking. Experimental (Chrome origin trial) — don't depend on it. Refs cloned to `.playground/html-in-canvas` (see `Examples/webgpu-jelly-slider`, `README.md`).
- v5 — Scale (compute-shader culling → indirect draw) *only when profiling demands*.

## Experiments (branches, not on main)
- **`exp/velocity-pointer-lock` — fly mode.** Velocity steering under the Pointer Lock
  API: `F` enters (Esc/`F` exit), the OS cursor hides and locks to canvas center,
  raw mouse deltas integrate into a virtual joystick "stick" (clamped to `radiusPx`)
  whose distance from center sets a continuous pan SPEED (÷zoom → zoom-stable). The
  center is the focus, so everything happens there: **left-click** stamps a 1×1,
  **hold Shift** freezes flying and lets the mouse size a rectangle from the center
  anchor (1:1 with the on-screen grid) — release Shift commits and resumes flying;
  **right-click** deletes under center, **Space** hard-stops. A center **crosshair**
  always shows while flying (marks the rectangle origin); the **ring + hint** are
  hidden by default behind a panel "show ring + hint" toggle (ring also hides while
  Shift-sizing). Unifies pan+draw into one mostly-mouse loop. Normal mode (V/R, drag-draw, click-select)
  kept alongside (additive). New: `src/fly.ts` (+ `fly.test.ts` for the velocity curve),
  HUD in `main.ts`, `FLY` tunables + panel Fly section, `UiState.locked`. Notes:
  browser owns Esc-to-exit (can't prevent) + a ~1s re-lock cooldown after Esc; DOM panel
  is unreachable while locked (exit to use it); `requestPointerLock` needs a real user
  gesture (fails gracefully otherwise — verified). *Feel-tuning (sensitivity/curve/…)
  pending live use; decide whether to merge, keep as a mode, or fold into main.*
  - **Persistence (built on this branch):** `src/persistence.ts` (+ `persistence.test.ts`)
    saves the document — rectangles (`{id,x0,y0,x1,y1}` + `nextId`) and camera view — to
    **localStorage** under a versioned JSON envelope (`grid.scene`, v1). Debounced saves on
    create/delete, a flush on page-hide/visibility-hidden (captures the latest view),
    hydrate on boot. Panel "Clear saved scene" button + `window.gridClearScene()`.
    Tolerant parser (drops bad rects, ignores a bad view, discards unknown versions).
    Verified round-trip in Chrome. *localStorage is ample for these tiny records; swap to
    IndexedDB later (behind the same interface) only if scenes get large/binary.*

- **`exp/isotropic-mode` — isotropic node rendering** *(branched off the fly branch)*.
  A `Projection → "isotropic nodes"` toggle (`CameraStruct.isoMode`). Off = today's
  anisotropic look (rect corners projected independently by Φ → foreshorten/stretch);
  on = each rectangle is drawn at a **single local scale** (√ of the two axis scales at
  its center, from `squashDeriv` = Φ-tail derivative) so it keeps **true proportions** —
  position still from Φ. Only the rect vertex shader changes (computes both clips + mixes
  by `isoMode`); the grid is untouched. Verified the toggle live in Chrome. *Decide
  whether isotropic should be per-node vs global, and whether the grid should follow.*

- **Media tiles (GIPHY) — BUILT on `exp/isotropic-mode` (static images).** The grid now
  holds only **media tiles** (images/gifs), painted as **GPU textures on the projected
  quad** (on-canvas, warps with Φ, no DOM → no drift). Per-instance via a **texture
  array** (`RectGPU.tex` layer; −1 = none). GIPHY via a **Vite dev proxy** (`/giphy/*`
  reads `GIPHY_API_KEY` server-side, appends it, strips cookies to dodge GIPHY's oversized-
  header 400 — key never enters the client). `src/giphy.ts` (search) + `src/giphySearch.ts`
  (picker overlay, "Powered by GIPHY"). Persists the tile's cell-AABB (image bytes not yet
  — `tex` index persists; pixels are re-fetched later, Phase 4).
  - **Interaction (rebuilt to the unified model — the whole rectangle/draw layer is gone).**
    One grammar: *drive a transform.* **Shift toggles grab ↔ fly** (grab = cursor drag-pan;
    fly = pointer-lock velocity). **A** = add → opens the GIPHY picker (drops the lock in
    fly so the popup is usable). Picking **attaches** the tile and you place it *by moving,
    in whatever mode you're in*: **grab-carry** = tile follows the cursor; **fly-carry** =
    tile pinned to the center crosshair while you fly the world. **Click drops** it,
    **right-click deletes** (under cursor / center), **Esc** cancels a carry. **Overlap
    allowed** (collage), size = ceil-to-cells of the image aspect. Removed: `F`/`R`, Draw/
    Select tools, rubber-band, 1×1 stamp, Shift-sizing, no-overlap. `UiState` is now just
    `{ locked }`. Verified the grab path end-to-end in Chrome (pick → follow → drop →
    persist). Fly path is symmetric but needs live testing (pointer lock isn't scriptable).
  - **Next:** animated playback (mp4 rendition → hidden `<video>` → per-frame
    `copyExternalImageToTexture`); persist image refs (re-fetch on load); LOD/rendition
    upgrades; live fly feel-tuning. HTML-in-Canvas stays reserved for arbitrary HTML later.

## v2 design — rectangles (decided)
Conceptual model: **a rectangle is a contiguous block of grid cells, given a fill** —
an annotation on the same lattice, not a new coordinate system. Geometry is **integer
cell coordinates**; it pans/zooms/compresses with the grid *for free* (world-anchored,
projected by Φ); no-overlap is an integer AABB test. Stored as a discrete object
`{id, cellMin, cellMax, …}`.

- **Interaction model — Option A (tool modes)** for now: a **Select/Pan** tool and a
  **Draw** tool, toggled by keys (`V`/`R`) and/or panel buttons; default = Select.
  In Draw mode, drag draws; in Select mode, drag pans and click selects. *(Deferred:
  Option B modifier — hold a key to draw; and the hybrid — tool modes + `Space`-drag
  to pan from any tool. Add later.)*
- **v2 scope: create + delete only.** No dragging/repositioning, no resizing (deferred).
- **Snap:** fixed base `G`. Cell `(i,j)` = `floor(world/G)`; covers world `[iG,(i+1)G]²`.
  Smallest rectangle = **1×1 cell**. *(Adaptive/zoom-aware snap deferred.)*
- **Create (rubber-band):** press = start cell (snapped); drag = live snapped preview
  from start→current cell (inclusive block); release = commit. **Empty click (no drag)
  = a 1×1 cell.** Preview shows **red/invalid** when it would overlap.
- **No-overlap:** forbid — an overlapping preview **won't commit**. **Touching edges is
  fine** (adjacent cells OK); only **shared interior cells** conflict. *(Deferred
  alternative: auto-clamp/shrink the new rect to the free space instead of forbidding.)*
- **Delete:** select a rectangle, then `Delete`; also right-click → delete.
- **Select:** click a rectangle → select (single-select); click empty → deselect.
  Selection's only job in v2 is to be the delete target (no move/resize). *(Multi-select
  deferred.)*
- **Appearance:** **translucent fill + a crisp outline**, with the direction-tint (and
  grid) **showing through** — reads as "this region of the grid, marked." *(Per-rectangle
  color / picker deferred; v2 uses one default fill.)*
- **Data + rendering (proposed, confirm):** rectangles as integer cell-AABBs in a JS
  array + a GPU **storage buffer** synced only on create/delete (not per frame).
  Rendered as **instanced quads** in a second, alpha-blended pass, corners projected via
  Φ (use **camera-relative** projection for precision far from origin). CPU picking =
  linear scan in cell space (add `flatbush` when counts grow). *(Alternative: paint
  rects inside the grid fragment pass via a cell test — simpler for tiny N, doesn't
  scale.)*
- **Deferred (v2+):** move/reposition, resize, per-rect color, multi-select,
  auto-clamp-on-overlap, persistence (rects are in-memory, lost on reload), dedicated
  toolbar UI, Option-B/hybrid input.

## Modules (current)
`main.ts` (root/context/pipelines/loop/resize) · `camera.ts` (uniform schema) ·
`tunables.ts` (GRID/COLORS/CAMERA/TAIL/FADE/ADAPTIVE/TINT) · `projection.ts` (Φ/Φ⁻¹ +
tails) + `projection.test.ts` · `spring.ts` · `pointer.ts` (screen→world helpers) ·
`interactions.ts` (pan/zoom/glide) · `rectangles.ts` (cell-AABB model + storage buffer
+ instanced-quad pipeline + Draw-tool rubber-band) · `fly.ts` (velocity pointer-lock;
branch) · `persistence.ts` (localStorage scene save/load; branch) · `logger.ts` +
`telemetry.ts` (observability) · `panel.ts` (settings UI) · `style.css`.
