# Architecture.md

**Project:** Infinite Rectangular Canvas *(a separable-projection infinite canvas)*
**Status:** v0.6 (living document — this is the source of truth; v1 built & verified, post-v1 UX/rendering enhancements layered on)
**Audience:** the autonomous coding agent building this project, and its human owner.

---

## 0. How to read and use this document

This file is the **constitution, specification, and operating manual** for this project at once. It is prescriptive about *invariants* (the goal, the terminology, the grid, the math, the architecture, the way of working) and open about *execution* (you, the agent, make and own the actual build plan).

Rules of engagement:

1. **This document is the source of truth.** When it conflicts with your prior assumptions, this document wins. When it conflicts with a tool's official docs *about that tool's usage*, the docs win — and you then update this document to record what you learned.
2. **Re-read the relevant sections before every step.** Do not work from memory of this file.
3. **This is a living document.** As decisions are made, resolved, or changed, update this file and commit the change to git with a clear message. Document and code evolve together.
4. **Do not start building until you have completed Phase 0 (Section 4) and received explicit human approval of your plan.**

The sections that explain *why* and *what it should feel like* (especially Sections 5 and 6) are not filler. They exist so that when you extend or change something, you change the right thing in the right place instead of pattern-matching to a superficially similar solution.

---

## 1. Mission

Build a production-grade, buttery-smooth (target ~60 fps), Chrome-only, **single-`<canvas>`** infinite canvas whose camera is a **non-linear, separable projection**: the plane is infinite, but its edges sit *at infinity* and are always visible — content shrinks as it recedes toward the edges and corners but never leaves the frame, and any region can be pulled back to the center where it expands to full ("original") size.

Everything is rendered inside one canvas on the GPU. There are **no DOM nodes** for content. Work is pushed onto the GPU as much as possible; the CPU's per-frame job is minimal.

**The grid is the foundational structure of this canvas** — an infinite orthogonal lattice of vertical and horizontal lines forming square cells, like an endless sheet of graph paper, *not* incidental decoration. It is described in full in Section 6, and it is the entire subject of v1.

**v1 scope is intentionally tiny: just that grid, rendered through the projection** — pan it, zoom it, glide the focus around it, and watch it compress toward the edges and expand at the focus. That is the entire first deliverable. Everything else (placing rectangles on the grid, links, text, etc.) is roadmap (Section 16), documented now so the architecture anticipates it, but **not built in v1**.

---

## 2. Terminology & the Mental Model

Language shapes implementation, so hold one crisp picture in mind and let it drive every naming and design choice.

**The picture:** two independent one-dimensional maps, one for X and one for Y. The horizontal position of anything depends only on its horizontal distance from the focus; its vertical position only on its vertical distance. Because the axes are handled independently, **a vertical line stays vertical and a horizontal line stays horizontal**, the frame stays a rectangle, infinity is a square (four edges and four corners), and a rectangle stays a rectangle. Everything in this project follows from that separable, per-axis, rectangular picture. When a name or a design choice can be phrased naturally in terms of "per-axis" and "straight lines stay straight," it fits; that phrasing is your compass.

**Vocabulary (use consistently):**
- **The projection (Φ):** the map from the infinite world plane to the bounded screen region. **Separable**: `Φ(x, y) = (f(x−Fx), f(y−Fy))` — X handled by `f` on the horizontal distance, Y by `f` on the vertical distance, independently.
- **Separable / per-axis:** the defining property. X depends only on horizontal distance from the focus, Y only on vertical distance. This is what keeps lines straight and the frame rectangular; prefer these words everywhere.
- **Compactification:** gluing "infinity" onto the plane as a reachable boundary — here, the rectangular frame's four edges (one coordinate at infinity) and four corners (both at infinity).
- **Focus:** the world point currently held at the screen center; the region shown at full scale. A view-center anchor. "Bring into focus" = "move to the center, where it renders at full size."
- **Grid:** the infinite orthogonal lattice of straight vertical + horizontal lines forming uniform square cells (Section 6).
- **World space / screen space:** flat data coordinates vs. pixels.
- **Center zoom (`z`):** magnification at the focus.
- **Anisotropic:** X and Y shrink by *different* amounts, producing foreshortening.
- **The projection / projected:** the preferred words for the map and its results. "Warp / warped" is acceptable as a generic term for the non-affine deformation.

A simple self-check keeps the model on track: you should always be able to describe the current behavior as "X as a function of horizontal distance, Y as a function of vertical distance, lines straight, focus at full scale." If a description or an implementation can't be stated cleanly in those per-axis terms, re-read Sections 5 and 6 before continuing.

---

## 3. Prime Directives (non-negotiable operating doctrine)

These govern *how* you work, on every task, for the life of the project.

1. **Consult the canonical source before acting.** Before using any tool, library, runtime, or framework feature, find and read its canonical documentation — official docs, `llms.txt` / `llms-full.txt`, README, the tool's own `--help`, or an official Skill/MCP. Treat your training-memory of any API as *stale and untrusted*; verify against current docs.
2. **Use tools, CLIs, and framework-provided commands canonically. Do not hand-roll what a tool does for you.** Never hand-write project scaffolding, config, boilerplate, or lockfiles when a `create-*`, `init`, scaffolder, generator, or framework command exists. Hand-write **only** the genuinely bespoke parts — application logic and shaders no generator produces.
3. **Discover and use available capabilities (MCPs, Skills) instead of reinventing them.** Enumerate what's available and use the right tool for each job (Phase 0).
4. **Plan, then checkpoint, then build.** Produce a plan, present it, and get human approval at the defined checkpoints (Sections 4 and 12) before writing implementation code.
5. **Report, don't guess.** When you hit a decision the human should make, an ambiguity, or a blocker (e.g., git init failing on a machine with custom global config), stop and report rather than assuming.
6. **Everything under version control.** Initialize git at the start; commit at every meaningful step. Git is our safety net and history.
7. **Keep this document current, and keep to the established vocabulary.** Any decision, deviation, or discovery updates `Architecture.md` in the same change. Name things using the project's mental model and vocabulary (Section 2) — per-axis, separable, straight-lines-stay-straight.

---

## 4. Phase 0 — Discovery & Reporting Protocol (do this first, then STOP)

Before any scaffolding or code, do the following and deliver a written report. **Do not proceed without explicit approval.**

### 4.1 Enumerate your environment
- List every **MCP server** you currently have, one line each.
- List every **Skill** you currently have, one line each.
- List the **runtimes/tools** actually present (Bun, Deno, Node, Vite, git, a browser for testing) with versions. Check; don't assume.

### 4.2 Identify what you need vs. have
Assess (recommend, don't assume):
- **A live-documentation / context MCP** (fetches current library docs on demand) — high value here because we forbid working from stale memory. If you lack one, recommend one to connect.
- **The official TypeGPU Skill and TypeGPU runtime-inspector MCP** (see the "AI Tools" page in the TypeGPU docs). Report whether you have them; if not, recommend adding them.
- **A browser-automation / Chrome MCP (Playwright-style)** for loading the canvas in Chrome and running automated visual + performance checks.
- **A filesystem / git MCP**, if you lack native file/shell access.

### 4.3 Recommend optional Skills/MCPs to the human
List genuinely useful ones with a one-line justification each. **Be honest about relevance:** for the v1 single-canvas architecture, DOM-UI frameworks like React are **not** needed — all content is drawn in the canvas. React/components become relevant only much later, and only for *chrome around* the canvas (toolbars, panels), the way Figma keeps panels in React while the document is a canvas. Don't recommend what doesn't fit; do flag what will.

### 4.4 Confirm runtime and toolchain (evaluate, then recommend)
Runtime is flexible (Bun, Deno, or Vite+TS all acceptable — "whatever works best"). Constraints:
- `unplugin-typegpu` must integrate cleanly with the chosen bundler/runtime (Vite/Webpack/Rollup/esbuild/Bun/Babel integrations exist) — needed *if* we author shaders in TypeScript (Section 10).
- Fast dev server + hot reload.
- Ability to run **headless WebGPU** (Dawn-backed) for unit-testing the math/compute, if available — verify current per-runtime status (confirm which of Bun / Deno / Node currently exposes a working `navigator.gpu`); report findings.
- Default lean (pending your verification): **Bun** (fast, first-class `unplugin-typegpu` plugin) or **Vite + TS** if smoother. Recommend one and say why.

### 4.5 Initialize git
- Initialize the repository.
- **If `git init` or the first commit fails or behaves oddly, STOP and report** — the human may have custom global git config/hooks and will help. Do not fight it silently.
- Add a sensible `.gitignore` via the canonical tool/template for the stack (not hand-rolled if a generator exists).

### 4.6 Produce your plan and STOP
- Deliver: environment report, recommendations (4.2/4.3), runtime recommendation (4.4), git status (4.5), and a **phased build plan** (methodology in Section 12; scope boundaries in Sections 15–16).
- **Wait for human approval before building.**

---

## 5. Background & Design Rationale (the WHY — read before the grid and the math)

This explains our intent, how we arrived at the design, and the reasoning, so you can extend it intelligently. The grid (Section 6) and the formulas (Section 7) are the *consequence* of this reasoning.

### 5.1 The experience we're creating
An infinite 2D canvas that does **not** behave like an ordinary pan/zoom canvas:
- The plane is infinite, yet all of it is always visible inside a finite frame.
- The four edges of the frame correspond to infinity. Content near the edges is shrunk; content at true infinity maps *onto* the edge. Nothing scrolls off-screen — it just gets small.
- There is a **focus** (view center). Content at the focus is at full, original scale, shrinking smoothly as it moves toward the edges.
- You can move the focus (drag/pan, or glide to a point) to bring any far region — including the extreme edges and corners — back to the center, where it expands to full size.

Because our eventual content is **rectangular nodes on a square grid**, the geometry must be rectangle-friendly: edges and corners reachable, and a rectangle stays a rectangle.

### 5.2 What this is, mathematically
Strip away the UI and this is a single map **Φ** from the infinite world plane ℝ² into a bounded screen region (an open rectangle). Φ is a homeomorphism: every world point lands strictly inside the frame; the boundary is "infinity." So we are building a **compactification of the plane** — gluing a boundary onto ℝ² so the edges-at-infinity become real, reachable-in-the-limit places.

The data itself stays flat, ordinary, Cartesian: nodes are honest rectangles, the grid is square, moving the focus is vector subtraction. **All the non-linearity lives in the rendering map Φ, not in the data.** (When our intent was first described as "it mustn't be Cartesian," that refers to the *view*, not the data — the data is Cartesian; only the projection is non-linear.) This separation is the backbone of the design (Section 8.3): do all real work in flat data space, and let Φ / Φ⁻¹ be the *only* bridge to the screen.

### 5.3 Some distortion is unavoidable, so we choose exactly what to preserve
Fitting an entire infinite plane inside a finite frame always costs *some* geometric fidelity — that is a fact of the mathematics, not a limitation of our approach. So the design question is simply: **which properties do we keep perfectly intact?** For a canvas whose content is rectangles on a square grid, the answer is clear and it drives everything: we preserve **straight lines** (they stay straight), **right angles** (rectangles stay rectangular), and **reachability of the whole frame** (every edge and both corners in each direction correspond to infinity and can be brought to the center). Size is the thing we let vary with distance; structure is the thing we hold exact.

### 5.4 Why the flat plane with a separable projection is the right home
Our content is rectangles on a square lattice, and rectangles need right angles and evenly-ruled square cells. The flat Euclidean plane provides exactly that, and a **separable, per-axis projection** carries those properties intact to the screen: because each axis is mapped independently, verticals stay vertical, horizontals stay horizontal, the four edges of the frame become the four "one-coordinate-at-infinity" directions, and the corners become the "both-at-infinity" directions. This is precisely the shape of space our rectangles and grid want, which is why we build on it.

### 5.5 The choice: a separable, square compactification, with anisotropic distortion
We compactify **each axis independently**: `Φ(x, y) = (f(x−Fx), f(y−Fy))`, a product of two independent 1-D projection functions. Consequences:
- **Infinity becomes a square:** the four edges are "one coordinate infinite," the four corners "both infinite." This is why corners are reachable and the whole rectangular frame fills — exactly what rectangular content wants.
- **Straight world lines stay straight on screen:** a vertical world line (constant x) maps to a vertical screen line, just non-uniformly spaced (dense toward the edges, spread at the focus). *This is the property that makes the grid in Section 6 possible and correct.*
- **Distortion is anisotropic:** X is compressed by horizontal distance and Y by vertical distance *independently*, so the two axes shrink by different amounts. A node far to the right but level with the focus is crushed horizontally while keeping its height — it foreshortens, like a rectangle tilting away.

**We lock ANISOTROPIC distortion for v1.** Rationale: it is internally honest (a node distorts exactly as the space around it does; node and grid always agree; one seamless deformation) and gives a felt sense of space receding into the distance. The cost — far nodes can become thin slivers — is acceptable because (a) v1 has no nodes, only a grid, and (b) far content is context you pull inward before interacting. Section 16 records the deferred **isotropic** alternative (position from Φ, but one uniform scale per node's shape) as a possible later toggle.

### 5.6 Why this rendering stack
- **Single canvas, drawn on the GPU, no DOM content.** DOM/SVG/Canvas2D can't do a non-linearly shrinking node at scale. (Figma reached the same conclusion: bypass the DOM, render your own scene on the GPU.)
- **We build our own camera layer.** Off-the-shelf infinite-canvas and node-graph libraries (React Flow/xyflow, tldraw, Excalidraw, Konva's stage, d3-zoom, Fabric, Mapbox, deck.gl) are built around a **single affine transform** (pan + one uniform zoom). Our projection is per-axis and non-linear, so owning the camera ourselves is the direct path — the projection *is* the thing we're building.
- **WebGPU, because we're Chrome-only and want compute + modern pipelines.** Chrome ships WebGPU stably; it gives compute shaders (to move work off the CPU) and a modern typed pipeline model. WebGL is not our target.
- **TypeGPU, because it makes the CPU↔GPU boundary type-safe without boxing us in.** One schema (`d.*`) defines the GPU type, CPU buffer layout, and TypeScript type at once (no manual byte alignment); shaders can be TypeScript (`'use gpu'`) or WGSL, mixed freely; you can eject to raw WebGPU anywhere (no lock-in). It's a *toolkit*, not an engine — crucially it does **not** impose an affine scene-graph camera on us.

### 5.7 The Figma parallel — and why we can't borrow its #1 trick
Figma is the reference high-performance custom web canvas: a C++/WASM engine painting to one canvas via (now) WebGPU, a scene graph updated by deltas, and a **tile-based** renderer that caches static regions as GPU textures so panning only re-composites. Our core loop echoes its philosophy: **keep the scene resident on the GPU, update by small deltas, don't rebuild each frame.**

But Figma's tiling depends on an **affine** camera — a cached tile stays valid under pan. Our projection is non-linear: the moment the focus moves, every pixel's mapping changes, so **no cached tile is reusable**, and tiling is unavailable to us. Our saving grace: our content is deliberately cheap to redraw from scratch each frame (v1 is a single analytic fragment-shader pass; later, instanced quads). Where Figma *must* cache because its content is expensive, we *brute-force re-render* because ours is cheap. Same goal, opposite strategy — the fork is entirely determined by affine-vs-non-linear camera. Keep this in mind before ever reaching for a tiling/caching optimization: it will not straightforwardly work here.

---

## 6. The Grid — intent, appearance, and affordances

The grid is **not decoration and not a placeholder**. It is the **foundational structure of the entire canvas** and the whole subject of v1. This section is the definitive statement of what we mean by "the grid." If an implementation choice would make the grid anything other than what's described here, it is wrong.

### 6.1 What the grid is, and why it is the point
Picture an infinite sheet of engineering **graph paper** — or a **blueprint**, a **drafting table**, the ruled backdrop of a **node editor** — extending forever in every direction, then gently receding toward a horizon on all four sides of the frame so its far reaches shrink into the edges without ever falling off. That is the grid.

Concretely it is a **regular orthogonal lattice**: one family of evenly spaced **vertical** lines and one family of evenly spaced **horizontal** lines, in world space, crossing to form **uniform square cells** of side `G` (world units). Two line families, both axis-aligned. Nothing else defines it.

It matters because it is three things at once:
- **The skeleton of the space** — the coordinate scaffold every future element (rectangles in v2) will sit on and snap to.
- **The instrument through which the user perceives the projection** — the grid is *how* you see "edges at infinity, focus at full scale, pull-a-region-in-to-expand-it." In v1 the grid is the only content, so **the grid is the experience.**
- **A promise of order** — a rectangular, axis-aligned, alignable world where structure is preserved. A design tool lives or dies on the user's trust that things stay aligned; the grid is that trust made visible.

### 6.2 Precise appearance
- **Two orthogonal line families only:** vertical lines at world `x = k·G`, horizontal lines at world `y = k·G`, for all integers `k`. Uniform square cells of side `G`.
- **Minor / major lines (graph-paper convention):** minor lines every cell; **major lines** every `M` cells (e.g. `M = 5` or `10`) drawn heavier/brighter, so the eye can count distance and read scale at a glance.
- **Origin cross:** the two axes (`x = 0` and `y = 0`) emphasized distinctly (a third, strongest weight/color) as the anchor of the plane.
- **Optional intersection dots:** subtle dots at line crossings *may augment* the lines (a common node-editor affordance), but the **lines are the defining structure** — dots never replace them.
- **Weights and colors:** subtle minor lines, stronger major lines, distinct axes; all tunable (7.7). Lines are crisp and uniform-width in *pixels* regardless of the projection (AA via `fwidth`).

### 6.3 How it must look and behave under the projection (hard requirements)
These follow directly from separability (Section 5.5) and are also correctness tests:
- **Straight stays straight, and axis-aligned stays axis-aligned.** A vertical world line renders as a **perfectly vertical** screen line; a horizontal world line as a **perfectly horizontal** screen line, at every focus and zoom. The correctness check is affirmative and simple: verticals read vertical, horizontals read horizontal — this falls out for free from the separable projection (Section 7.5), and confirming it is the primary visual test.
- **Square at the focus.** Cells at/near the focus are full-size squares (side ≈ `G·z` pixels at zoom `z`).
- **Compress toward the edges while staying axis-aligned.** Moving away from the focus, cells compress smoothly into thin, axis-aligned rectangular bands. Horizontal spacing compresses with horizontal distance; vertical spacing with vertical distance (anisotropic, per Section 5.5).
- **Density gradient = the signature of infinity.** Near each of the four edges the lines bunch ever denser (infinitely, in the limit). That thickening toward the border is the visible fingerprint of "this edge is infinity."
- **Seamless under motion.** As the user pans, zooms, or glides the focus, the grid slides and scales continuously — no popping of lines in/out, no shimmer, no jitter, no aliasing crawl.

### 6.4 Affordances — what the grid gives the user
The grid is chosen for what it *communicates and enables*, not just how it looks:
- **Orientation and sense of place.** The origin cross and the moving lattice tell you where you are on the infinite plane and which way is "home."
- **A built-in ruler / scale reference.** Cell size reports the current zoom; major lines let you count distance; comparing near-focus cells to edge bands makes the shrink legible at a glance.
- **A compass to infinity.** The density gradient toward each edge shows, at a glance, how far and in which direction "infinity" lies.
- **Motion feedback.** During pan / zoom / glide, the sliding, scaling grid makes the interaction tangible — you *feel* the plane move and scale beneath you. This is a large part of the "buttery" quality we want.
- **Alignment and structure (foreshadowing v2).** The cells are the future placement and snapping targets; even empty, the grid advertises "content goes here, on this lattice, aligned." This is the affordance that makes v2's click-to-place feel inevitable.
- **Reassurance of orthogonality.** Because the lines are always straight and axis-aligned, the grid continuously reassures the user that this is a rectangular world where alignment holds — you can trust that things line up, which is exactly the confidence a design/diagram tool must give.

### 6.5 Interaction affordances
- **v1 (required):** pan (grab-and-pull), zoom-about-cursor, and focus-glide all act on the grid; the grid is the visible subject of every interaction (Section 7.6).
- **v1 (optional niceties — propose and confirm):** a subtle **hover highlight** of the grid cell under the cursor (signals that cells are meaningful/interactive), and/or a small **coordinate readout** of the focus and/or cursor world position (reinforces orientation and scale). Include only if they don't compromise the 60 fps target or the single-pass simplicity.
- **v2+ (foreshadowed):** click a cell to place a rectangle that snaps to it; a snapping/placement preview highlight. Design the v1 grid so these drop in naturally.

### 6.6 The grid's defining guarantees (hold all of these true)
Everything about the grid reduces to these affirmative guarantees — if the implementation upholds them, it is correct by construction:
- **Two straight, axis-aligned line families:** verticals and horizontals, and only those two families define it.
- **Uniform, regular spacing:** a constant world spacing `G` everywhere, giving square cells — the lattice is perfectly regular.
- **Flat and upright:** the lattice lies flat on the world plane and stays upright (no skew, no rotation) at every focus and zoom.
- **Lines are the substance:** the two line families are what the grid *is*; intersection dots, if present, only decorate them.
- **Straight under the projection:** the projection keeps every line straight and axis-aligned — this is guaranteed by separability (Section 7.5), so upholding it is automatic when the projection is implemented per spec.

### 6.7 Grid tunables (see also 7.7)
Cell spacing `G`; major-line interval `M`; colors and weights for minor / major / axis lines; optional intersection dots (on/off, size, color); optional hover highlight; optional coordinate readout; AA line width; default zoom. Expose these; they are how the grid's look and affordances get dialed in.

---

## 7. Mathematical Specification

> **Status: REFERENCE IMPLEMENTATION.** These formulas are verified (forward/inverse round-trip error ~1e-12; points at infinity map exactly onto the boundary). Implement as given for v1. You **may** propose alternatives, but only with written justification tied to Sections 5–6, raised at a checkpoint.

### 7.1 Spaces, notation, camera state
- **World space:** the infinite flat plane, `(x, y)` in world units.
- **Screen space:** pixels; view center `C = (Cx, Cy)`, half-extents `Wx = width/2`, `Wy = height/2` (CSS pixels; account for `devicePixelRatio`, capped ~2).
- **Camera state (the entire per-frame CPU→GPU upload):**
  - `F = (Fx, Fy)` — focus (world point at screen center).
  - `z` — center zoom (near the focus, 1 world unit ≈ `z` px).
  - viewport half-extents `Wx, Wy` (derivable from a `resolution` uniform).
  On the order of ~32 bytes. Nothing else changes per frame in v1.

### 7.2 Forward projection Φ (world → screen)
Per-axis, separable. Let `dx = x − Fx`, `dy = y − Fy`. Screen offset from center `(ox, oy)`:

```
ox = Wx * (z * dx) / (z * |dx| + Wx)
oy = Wy * (z * dy) / (z * |dy| + Wy)
screen = (Cx + ox, Cy + oy)
```

Near the focus `ox ≈ z·dx` (full scale, magnification `z`); as `|dx| → ∞`, `ox → ±Wx` (the edge). Same for `y`. Corners are `(±∞, ±∞)`.

### 7.3 Inverse projection Φ⁻¹ (screen → world) — closed form
Needed for the analytic grid and interactions. Given screen offset `(ox, oy)`, let `u = ox/Wx`, `v = oy/Wy` (each in `(−1, 1)`; **clamp to `±(1 − ε)`** to avoid the edge singularity):

```
dx = u * Wx / (z * (1 - |u|))
dy = v * Wy / (z * (1 - |v|))
world = (Fx + dx, Fy + dy)
```

### 7.4 Local scale / Jacobian (anisotropy) — for FUTURE node rendering
For drawing a node (roadmap, not v1), the separable map's Jacobian is diagonal — per-axis screen scale at `(dx, dy)`:

```
sx = z * Wx^2 / (z * |dx| + Wx)^2
sy = z * Wy^2 / (z * |dy| + Wy)^2
```

At the focus `sx = sy = z`; both → 0 at the edges, at different rates (this *is* the anisotropy). **Because the map is separable, a node is drawn correctly by projecting its four edges through Φ independently — the result is an exact axis-aligned screen rectangle**, and foreshortening emerges for free. (Store for v2; unused in v1.)

### 7.5 The grid — analytic, in the fragment shader (this IS v1's render)
v1 needs no geometry beyond a single full-screen triangle/quad. The fragment shader does everything (this is the concrete realization of Section 6):

1. For the current pixel, compute its screen offset `(ox, oy)` from center.
2. Apply **Φ⁻¹** (7.3) to get the world coordinate `(wx, wy)` under this pixel.
3. Compute distance to the nearest world gridline (e.g., via `fract(wx / G)`, `fract(wy / G)` for spacing `G`) and draw a minor line where that distance is small; draw a **major** line where the coordinate is also a multiple of `M·G`; draw the **axes** where `wx ≈ 0` or `wy ≈ 0`, each with its own weight/color (Section 6.2).
4. **Anti-alias with screen-space derivatives:** use `fwidth`/`dpdx`/`dpdy` to measure line thickness in *pixels* so lines stay crisp and uniform-width regardless of the mapping.

The inverse blows up toward the edges (world → ∞), which is *correct* — gridlines bunch infinitely near the frame edge; handle it numerically (the `ε` clamp). Because the mapping is separable, screen-vertical lines come only from `wx` tests and screen-horizontal lines only from `wy` tests, so lines are always axis-aligned by construction — satisfying Section 6.3. This warps the grid perfectly with **zero tessellation** and perfect AA, and it's the flagship reason the whole thing is cheap: the closed-form Φ⁻¹ makes the per-pixel inverse trivial.

### 7.6 Camera and interactions (reference behavior)
All of these change only camera state `F` and `z`:
- **Pan / drag ("grab and pull"):** on pointer-down, record the world point under the cursor `W0 = Φ⁻¹(cursor)`. On move, set `F = W0 − Φ⁻¹(cursorOffset)` so the grabbed world point stays glued under the cursor. (Grab a shrunken edge region, drag it to center, watch it expand.)
- **Zoom (wheel / pinch), about the cursor:** record `W0 = Φ⁻¹(cursor)`; update `z` (clamp e.g. `[0.35, 3]`, exponential per wheel delta); set `F` so `Φ(W0)` returns to the cursor — `F = W0 − Φ⁻¹(cursorOffset)` with the new `z`. Keeps the point under the cursor fixed.
- **Focus glide (double-click / programmatic):** target `Ftarget = Φ⁻¹(point)`; animate `F` from current to target with a **spring** (interruptible; better feel than fixed easing).

### 7.7 Tunables (expose these; real design knobs)
- **Sigmoid tail** — the rational map `d/(|d|+W)` has a *heavy* (1/d) tail: distant content compresses slowly, so lots of context lingers near the edge. `tanh` (exponential tail) keeps less far context; `atan` sits between. A genuine, tunable choice — keep the map swappable.
- **Grid** — spacing `G`, major-line interval `M`, minor/major/axis colors and weights, optional intersection dots (Section 6.7).
- **Zoom clamp range** and wheel sensitivity; default zoom.
- **`devicePixelRatio` cap** (≈2).

---

## 8. Rendering Architecture

### 8.1 v1 render (build exactly this)
A single full-screen pass:
- A vertex shader emitting a full-screen triangle (no vertex buffers).
- A fragment shader implementing Section 7.5 (analytic grid via Φ⁻¹ + `fwidth` AA, with minor/major/axis lines per Section 6).
- One small **camera uniform** (7.1) — the only thing updated per frame.
- A `requestAnimationFrame` loop. Optionally render only on camera change (dirty flag) to save power; during interaction it changes continuously, which is fine because this pass is cheap.

That's the entire v1 renderer. No instancing, no storage buffers, no compute.

### 8.2 The general pipeline (FUTURE — design-aware, don't build in v1)
As content arrives (roadmap), the pipeline grows into:
- **Instanced quads** for rectangles: one unit quad, N instances; the vertex shader reads each instance's world rect and applies Φ to its corners (separable → exact axis-aligned screen rect, anisotropy for free). One draw call.
- **GPU-resident node storage buffer** (Section 9): uploaded once, updated by deltas.
- **Analytic shader elements** (grid, rulers) stay fragment-shader-based.
- **Compute-shader culling → indirect draw** (much later, only when profiling justifies): reject off-screen / sub-pixel nodes on the GPU, compact to an indirect draw. **Do not build prematurely** — brute instancing handles very large rect counts fine.

### 8.3 The load-bearing invariant
- All real work (layout, math, future hit-testing/collision) happens in **flat data space**.
- **Φ and Φ⁻¹ are the only bridge** between data space and screen space.
- Moving the focus is a plain translation applied *before* Φ: `Φ(p − F)`.
- The **only** per-frame CPU→GPU write is the small camera uniform. Node data is static on the GPU until it changes, and then only the delta is written.

Design every future addition to preserve this invariant.

---

## 9. Data Model (FUTURE — define the shape now, implement post-v1)

v1 has **no node data** — only the camera uniform. But design the schema now so the architecture anticipates it and a future compute stage can read it.

- A node record (reference shape, to refine): `{ position: vec2f, size: vec2f, color: vec4f (or packed u32), flags: u32 }`, defined once as a TypeGPU `d.struct` so it yields GPU type, CPU layout, and TS type together.
- The full set is a **storage buffer** (`d.arrayOf(NodeStruct, N)`, `$usage('storage')`), readable by both vertex and (future) compute shaders.
- A **"delta"** is a targeted write to one record's slice (move/resize/recolor), *not* a full re-upload. Keep an interface for this from the start.
- Because content snaps to the grid (Section 6.4), node positions/sizes are naturally expressed in **grid-cell units** (multiples of `G`) — design the schema and placement logic with that in mind.
- Design it to be **compute-readable** so a future cull/layout compute pass consumes the same buffer without restructuring.

Keep this section honest about built vs. planned as you implement.

---

## 10. Tech Stack & Tooling

Verify each against current canonical docs before use (Directive 1). Starting points to consult:
- **TypeGPU** docs: `https://docs.swmansion.com/TypeGPU/` (start with *Getting Started* and *Fundamentals*; find the *AI Tools* page for the official Skill + runtime-inspector MCP). Look for `llms.txt` / `llms-full.txt` at the docs root.
- **`unplugin-typegpu`** (npm): the build plugin required *only* for TypeScript-authored shaders (`'use gpu'`). Wire it into the chosen bundler canonically. Without it, `'use gpu'` functions ship as plain JS and won't run on the GPU.
- **`@webgpu/types`** (npm): add to `tsconfig` `types` so WebGPU types resolve.
- **`tsover`**: Software Mansion's TS fork adding operator-overload type-checking for vector/matrix math (`a + b` on a `vec2f`). Needed if you write GPU math with operators in TS.
- **`tgpu-gen`** (CLI): generates typed bindings from existing `.wgsl` files — use it if you keep any shaders as `.wgsl` rather than authoring in TS.
- **`@typegpu/*` helper packages** (e.g. noise, color, sdf) as needed.

Application libraries (recommend/confirm, don't over-add):
- **Input:** consider `@use-gesture` to normalize wheel / trackpad-pinch / pointer into clean pan/zoom (Chrome desktop trackpad pinch matters). Plain pointer events are also fine for v1 — evaluate and choose.
- **Spring** for focus-glide: a tiny spring integrator or a small library. Interruptible.
- **(FUTURE) `flatbush` / `rbush`** for CPU spatial indexing (node picking/culling) — **not needed in v1** (no nodes, no picking).

TypeGPU canonical-usage reminders (verify against docs): create **one `root`** at startup (`tgpu.init()` for a fresh device, or `tgpu.initFromDevice(device)` to wrap one); `root.configureContext({ canvas, ... })`; define layouts once with `d.*`; resources from different roots can't interact. Eject to raw WebGPU anywhere if needed.

Decision to record: **WGSL-in-TypeScript (`'use gpu'`) vs. WGSL strings.** In-TS gives type-safety and lets Φ / the grid live alongside the rest of the code (preferred for maintainability, and the main reason we chose TypeGPU) but requires `unplugin-typegpu`. WGSL strings need no build plugin. Recommend one at the Phase-0 checkpoint.

---

## 11. Runtime & Environment

- **Runtime/bundler is flexible** (Bun, Deno, or Vite+TS all acceptable). Evaluate and recommend in Phase 0. Requirements: fast dev server + HMR; clean `unplugin-typegpu` integration; ideally headless WebGPU for tests.
- The human has **Bun and Deno** available and is happy with either (or Vite). Default lean, pending verification: **Bun** (fast, first-class `unplugin-typegpu` plugin) or **Vite+TS** if smoother.
- **Headless WebGPU for testing:** verify current support per runtime (Deno has shipped a `navigator.gpu`; confirm Bun's current status) so we can unit-test Φ/Φ⁻¹ and compute without a browser. Report findings; if none is viable, run math tests as plain TS and do GPU/visual verification in Chrome.
- For any adopted runtime/tool, **seek its `llms.txt` and official docs/Skills** and follow the canonical setup.

---

## 12. Development Methodology & Milestones

- **No throwaway spike.** Go straight to the canonical, production-grade project, scaffolded via proper tooling (Directive 2).
- **Phased and checkpointed.** After Phase 0 approval, propose a v1 phase plan with independently verifiable steps. Suggested shape (you own the final plan):
  1. Canonical project scaffold + git + `unplugin-typegpu`/`@webgpu/types` wired + a WebGPU "clear the canvas" smoke test in Chrome.
  2. Camera uniform + full-screen pass + a *static* (unprojected) grid — verify vertical/horizontal lines, square cells, minor/major/axes render correctly before any projection.
  3. Implement Φ⁻¹ in the fragment shader → the projected grid; confirm lines stay perfectly straight and axis-aligned, cells compress toward the edges (Section 6.3).
  4. Interactions: pan (grab-and-pull), zoom-about-cursor, focus-glide spring.
  5. Polish: `fwidth` AA, dpr handling, tunables, optional hover-highlight/coordinate readout, 60 fps validation.
- **Checkpoints:** stop for human review after (a) the Phase-0 report/plan, and (b) your v1 phase plan. Then run the phases with autonomy, reporting progress and committing to git at each step. Raise blockers immediately (Directive 5).
- **Git discipline:** meaningful commit per step, clear messages; the human relies on history to review and roll back.

---

## 13. Testing & Validation

- **Math unit tests:** Φ / Φ⁻¹ round-trip (~1e-12), edge behavior (large `d` → `±W`), zoom-about-cursor invariance (world point under cursor stays fixed). Run headless if a runtime provides WebGPU; else as plain TS.
- **Grid correctness (Chrome, and automatable):** vertical world lines render perfectly vertical and horizontal perfectly horizontal at multiple focuses/zooms (no curvature/skew — Section 6.3); square cells at the focus; minor/major/axis lines present and distinct; density increases smoothly toward all four edges; corners reachable.
- **Visual checks (Chrome):** grid never leaves the frame; no shimmer/aliasing on lines; no artifacts at the extreme edges (the `ε` clamp); smooth, seamless motion under pan/zoom/glide. A browser-automation MCP can snapshot these.
- **Performance target:** ~60 fps during continuous pan/zoom. Measure with Chrome DevTools / a frame-timing overlay; the v1 pass should be trivially within budget. Record method and results.
- Keep tests in the repo, runnable via a canonical task/command.

---

## 14. Definition of Done — v1

v1 is complete only when **all** of the following hold, are demonstrated, and are committed:
1. Project scaffolded via canonical tooling; git initialized; `unplugin-typegpu` + `@webgpu/types` wired (if using TS shaders); builds and runs in Chrome with no console errors.
2. A single full-screen pass renders an **infinite orthogonal grid** (evenly spaced vertical + horizontal lines forming square cells) through the projection Φ, with **minor lines, major lines every `M` cells, and an emphasized origin cross** (Section 6.2).
3. **Lines are correct under the projection:** vertical world lines render **perfectly vertical** and horizontal world lines **perfectly horizontal**, at every focus and zoom — the primary visual correctness test (Section 6.3).
4. **Edges/corners at infinity:** the grid compresses toward all four edges (visible density gradient) and never leaves the frame; corners are reachable.
5. **Focus at full scale:** cells near the focus are full-size squares and expand/contract correctly as focus/zoom change.
6. **Interactions:** **pan (grab-and-pull)** keeps the grabbed world point under the cursor; **zoom-about-cursor** keeps the world point under the cursor fixed; **focus-glide** springs smoothly to a double-clicked point.
7. Grid lines are crisp (`fwidth` AA), motion is seamless (no popping/shimmer/jitter).
8. **~60 fps** sustained during continuous interaction, measured and recorded.
9. **Φ / Φ⁻¹ round-trip tests pass**; grid-correctness checks (item 3) pass.
10. Tunables (grid spacing `G`, major interval `M`, line colors/weights, zoom clamp/sensitivity, sigmoid tail, dpr cap) are exposed and adjustable.
11. Naming throughout the codebase follows the project's mental model and vocabulary (Section 2); `Architecture.md` is updated to reflect the built state.

---

## 15. Guardrails & Non-Goals (v1)

- **Single `<canvas>` only. No DOM content nodes.** All rendering inside the canvas on the GPU.
- **The grid stays true to its defining guarantees:** two straight, axis-aligned line families, uniform spacing `G`, flat and upright, at every focus and zoom (Section 6.6).
- **We own the camera.** Build the projection and camera ourselves rather than adopting an affine-camera library (React Flow/xyflow, tldraw, Excalidraw, Konva stage, Fabric, deck.gl, Mapbox) — those assume a single affine transform, whereas ours is per-axis and non-linear.
- **Anisotropic distortion is locked for v1.**
- **Naming follows the established vocabulary (Section 2)** in code, identifiers, comments, and docs.
- **Do not build (v1):** rectangles/nodes, node storage buffers, instanced rendering, picking/spatial index, links/edges, text, LOD, compute-shader culling / indirect draw, isotropic mode, tiling/caching. All are roadmap.
- **Do not hand-roll** project setup, config, or boilerplate where tooling exists (Directive 2).
- **Do not optimize speculatively** (compute-cull, tiling) — brute-force is correct and fast for v1, and tiling can't work with this camera anyway (Section 5.7).

---

## 16. Roadmap (post-v1, documented so the architecture anticipates it)

- **v1 — Projected grid (this build):** infinite orthogonal grid through the separable projection; pan (grab-and-pull), zoom-about-cursor, focus-glide; analytic fragment-shader rendering; anisotropic. Full-screen pass only.
- **v2 — Rectangles on the grid:** click a grid cell to place a rectangle that **snaps to the grid** (the grid's core affordance, Section 6.4). Introduces the node storage buffer (Section 9), instanced-quad rendering with Φ in the vertex shader, and CPU picking (`flatbush`) for click-to-place / select. Rectangles foreshorten (anisotropic).
- **v3 — Links between nodes:** connectors **tessellated along their length** so they curve correctly under the projection (a straight world segment is not straight on screen except along an axis).
- **v4 — Text & LOD:** crisp text (MSDF/bitmap fonts) inside nodes; level-of-detail so far nodes degrade gracefully (colored quad → +title → full) — also where anisotropic slivers get "rescued" visually.
- **v5 — Scale:** compute-shader culling → `drawIndexedIndirect`, off-main-thread work, etc., **only when profiling justifies it.**
- **Optional / parallel:**
  - **Isotropic mode toggle** — position from Φ but a single uniform scale per node so rectangles keep true proportions (the "clean diagram" look vs. v1's "immersive" look). The Jacobian (7.4) already anticipates this.
  - **Grid enhancements** — adaptive `G` (grid subdivides/coarsens as you zoom so cells never get too dense or sparse), snapping guides, coordinate rulers along the frame.
  - **Sigmoid-tail tuning UI** (rational vs. tanh vs. atan) and other tunables.
  - **Persistence / serialization** of the scene.
  - **Surrounding chrome** (toolbars/panels) — the *only* place a DOM-UI framework (e.g. React) could legitimately enter, kept outside the canvas à la Figma.

Update this roadmap as reality diverges.

---

## 17. Open Questions for the Agent (resolve or ask — do not silently assume)

1. **Runtime/bundler:** Bun vs. Deno vs. Vite+TS — recommendation + confirmation (4.4, 11).
2. **Shaders:** WGSL-in-TS (`'use gpu'` + `unplugin-typegpu`) vs. WGSL strings (Section 10). Recommend one.
3. **Headless WebGPU for tests:** which runtime actually provides it right now? (11, 13.)
4. **Input:** `@use-gesture` vs. hand-rolled pointer handling for v1 (Section 10).
5. **Focus-glide spring:** library vs. tiny hand-rolled integrator (7.6, 10).
6. **MCPs/Skills:** which you have, which you need, which the human should connect (Section 4).
7. **Grid aesthetics & options (propose defaults, confirm):** cell spacing `G`; major-line interval `M`; minor/major/axis colors and weights; optional intersection dots (on/off); optional cell hover-highlight; optional coordinate readout; default zoom.
8. Anything this document is silent or ambiguous on — raise it rather than guessing.

---

## 18. Change Log (keep updated; commit with each change)

- **v0.6** — **Post-v1 UX & rendering exploration** (v1's Definition of Done from v0.5 remains met; these are enhancements layered on top, built interactively with the human. Nothing from v1 was removed; the spec sections below still describe the v1 baseline, and this entry records where the built state now differs, with section cross-references).
  - **Observability:** added `src/logger.ts` (tslog — verbose, timestamped, per-subsystem structured logging; `window.gridLog` for live level control) and `src/telemetry.ts` (logs every pointer/wheel/mouse/keyboard event). `window.gridCam` / `window.gridSettings` expose live state. High-frequency streams sit at the lowest level so the console can be quieted without a rebuild.
  - **Precision — camera-relative grid phase (extends §8.3):** grid phase is now measured *relative to the focus* via per-level CPU-f64 fractional offsets uploaded in the uniform, so the shader's `fract` only ever sees small numbers. This restored Φ's translation invariance — the lattice stays crisp arbitrarily far from the origin (verified at focus 6.8e9), fixing a far-focus "gray-out" where absolute-world f32 coordinates lost sub-cell precision.
  - **Edge rendering — adaptive multi-level grid (evolves §6.2, §7.5, §8.1):** the fixed minor/major pair is superseded by **`ADAPTIVE.levels` (=10) nested grids** at world spacing `G·5ⁿ`, summed additively in the fragment. Each level is `fract`/`fwidth`-anti-aliased and **derivative-faded** where its on-screen spacing bunches ("edge fade"). Result: (a) fine levels fade near the edge while coarser ones stay crisp → the lattice reaches to within a fraction of a pixel of the frame edge with **no gray mush and no empty margin**; (b) the minor/major/super-major hierarchy of §6.2 now **emerges for free** from additive coincidence (a line shared by coarser levels is brighter) rather than from hard-coded weights. The origin cross is still drawn explicitly on top. (Design path: single-frequency + fade ["option A"] left a "pseudo-edge / empty margin"; the multi-level version ["A+B"] is the built default.)
  - **Direction color tint (realizes the §6.4 "compass to infinity"):** the background field is tinted by the **world coordinate** under each pixel, so color is one fabric with the grid — it pans, compresses, and expands with the projection. CIELAB-style opponents (+x = blue, −x = yellow, +y = red, −y = green), neutral at the world origin, saturating to the four edge-infinities via an overflow-safe rational squash `p/(|p|+1)` (not `tanh`, which NaNs on the GPU for the ~1e6 `world/scale` values near the edges → colored-band artifacts). Lines stay neutral on top.
  - **Uniform pan (deviates from §7.6 "grab and pull"):** dragging now translates the focus by *pointer-delta ÷ zoom* (the focus/center scale) — a **constant control rate regardless of grab location**, eliminating the "edge flinging" where grab-and-pull inherited the projection's huge local scale near the edges. Identical to grab-and-pull near the center. Zoom-about-cursor and focus-glide are unchanged. (Principle: the projection distorts what you *see*, not how *input* behaves — uniform control-display gain.)
  - **Settings panel (realizes §16 "surrounding chrome" early):** `src/panel.ts` — a vanilla-DOM, collapsible top-center panel (no framework), with all knobs live via the uniform: per-level enable chips, edge-fade start/end, line opacity + width, tail select, zoom, origin-axes toggle, direction-tint strength + scale, reset settings/view.
  - **New uniform fields** (`CameraStruct`): `tailMode`, `focusLevelFrac: vec4f[levels]` (`.xy` = per-level f64 phase, `.z` = per-level enable), `fadeStartPx`, `fadeEndPx`, `lineAlpha`, `lineHalfPx`, `axesOn`, `tintStrength`, `tintScale`.
  - **New tunables** (`src/tunables.ts`): `FADE`, `ADAPTIVE` (levels/base/halfPx/alpha), `TINT` (strength/scale/opponent colors). **New modules:** `logger.ts`, `telemetry.ts`, `panel.ts`.
  - **Roadmap note (§16):** "adaptive `G`" is now effectively realized by the multi-level grid. Still deferred: rectangles/nodes (v2), links (v3), text/LOD (v4), isotropic mode, snapping guides, coordinate rulers/readout, hover highlight, persistence, colored lines, tint presets/palette UI, pan inertia, zoom-glide, prod-gating the verbose logging.

- **v0.5** — **v1 built and verified** (Definition of Done §14 met). Summary of the built state:
  - **Toolchain:** scaffolded canonically via the TypeGPU CLI (`vite-bare`) — **Vite 8 + TypeScript (tsover)**, `unplugin-typegpu`, `@webgpu/types`, `oxlint`/`oxfmt`, `eslint-plugin-typegpu`. Runs in Chrome with no console errors; production `build` clean. (Corrected the doc's stale "Bun first-class plugin" lean: the actively-maintained `unplugin-typegpu` targets are Vite/Rollup + Babel.)
  - **Render:** single full-screen pass — `common.fullScreenTriangle` + a TGSL `'use gpu'` fragment reading one `Camera` uniform (`focus`, `zoom`, `resolution`, `tailMode`) via `root.createUniform`. Analytic grid — minor lines, major every `M=5`, emphasized origin cross — anti-aliased with `std.fwidth` on the smooth `world/spacing` field.
  - **Projection:** **Φ⁻¹ in the fragment** (§7.3). Lines stay perfectly axis-aligned; cells are full-scale at the focus and compress toward all four edges with a density gradient; corners reachable.
  - **Interactions** (§7.6): pan (grab-and-pull), zoom-about-cursor, focus-glide (critically-damped, interruptible `Spring`). All mutate only camera state; CPU `Φ`/`Φ⁻¹` twins live in `projection.ts`.
  - **Sigmoid tail** (§7.7) is **swappable at runtime** via the `tailMode` uniform — `rational` (default) / `tanh` / `atan`, each normalized to unit magnification at the focus.
  - **Tests:** 28 Vitest cases (`src/projection.test.ts`) — Φ/Φ⁻¹ round-trip, edges-at-infinity (`|d|→∞ → ±W`), focus magnification ≈ z, zoom-about-cursor invariance, oddness — green across all three tails.
  - **Performance:** sustained the display's full **120 Hz** (p50 frame interval 8.3 ms, p95 9.3 ms) at 3456×1814 device px during continuous pan+zoom — well beyond the ~60 fps target. Method: in-page `requestAnimationFrame` timing over 2 s of continuous synthetic interaction.
  - **Tunables** (`src/tunables.ts`): `G`, `M`, minor/major/axis colors+weights, zoom clamp + wheel sensitivity, `TAIL`, DPR cap (=2), default zoom.
  - **Modules:** `main.ts` (root/context/pipeline/loop/DPR-capped resize), `camera.ts` (uniform schema), `tunables.ts`, `projection.ts` (Φ/Φ⁻¹ + tails), `spring.ts`, `interactions.ts`.
  - **Deferred (roadmap §16):** optional hover cell-highlight + coordinate readout (kept the pass single and simple), isotropic mode, rectangles/nodes and everything beyond. A full clone of the TypeGPU repo lives in the git-ignored `.playground/` for local docs.

- **v0.4** — Converted the document to **positive-only steering**. Replaced the terminology section with a vivid statement of the intended mental model and vocabulary (no forbidden-word list, which would only prime the wrong ideas for an LLM). Recast the design rationale (5.3–5.4), the grid's guarantees (6.6), the guardrails (15), the directives (7), and the Definition of Done (14) as affirmative statements of what to build, rather than catalogs of what to avoid. Every constraint is now expressed as a property to uphold.
- **v0.3** — Added Section 6 ("The Grid"): a full, vivid, exhaustive definition of the grid as an orthogonal vertical+horizontal lattice of square cells (graph-paper/blueprint model), with appearance spec, behavioral guarantees under the projection, affordances, and interaction affordances. Foregrounded the grid in the Mission and threaded it through the math (7.5), rendering (8.1), data model (9), methodology (12), testing (13), Definition of Done (14), guardrails (15), roadmap (16), and open questions (17). Renumbered sections 6→7 onward.
- **v0.2** — Established the separable/rectangular mental model as the single vocabulary; added the Terminology and Definition-of-Done sections; renamed the project to "Infinite Rectangular Canvas (separable projection)"; clarified that the *data* is Cartesian and only the *view* is non-linear. Minor tightening throughout.
- **v0.1** — Initial architecture and handoff meta-prompt. v1 scoped to the grid + camera interactions; anisotropic locked; canonical-tooling doctrine; Phase-0 discovery/checkpoint protocol; roadmap for rectangles-and-beyond.

*(Append future revisions here as the project evolves.)*