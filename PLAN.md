# PLAN.md — open questions, tasks, deferrals, roadmap

Working companion to `ARCHITECTURE.md` (the source of truth). This tracks what's
*not yet done*. Update alongside commits. Status as of change log **v0.6**.

---

## Status
v1 (projected grid + interactions) is **built, verified, committed** (DoD §14).
Post-v1 enhancements shipped: verbose logging/telemetry, camera-relative precision,
adaptive multi-level grid + edge fade, world-direction color tint, uniform pan,
live settings panel. All pushed to `origin/main`.

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
- **Logging default is SILLY (fully verbose)** — dial to DEBUG and/or gate to dev-only
  (`import.meta.env.DEV`) before any "production" use.
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
Tooling: TypeGPU Runtime Inspector MCP (not wired). Persistence: scene serialization.

## Roadmap (next milestones — §16)
- **v2 — Rectangles on the grid** *(NEXT — actively planning):* click a cell → place a
  rectangle that snaps to the grid. Introduces the node **storage buffer** (§9),
  **instanced-quad** rendering with Φ in the vertex shader, and **CPU picking**
  (`flatbush`) for click-to-place/select. Rectangles foreshorten (anisotropic).
- v3 — Links between nodes (tessellated along their length).
- v4 — Text & LOD (MSDF/bitmap fonts; degrade far nodes gracefully).
- v5 — Scale (compute-shader culling → indirect draw) *only when profiling demands*.

## Modules (current)
`main.ts` (root/context/pipeline/loop/resize) · `camera.ts` (uniform schema) ·
`tunables.ts` (GRID/COLORS/CAMERA/TAIL/FADE/ADAPTIVE/TINT) · `projection.ts` (Φ/Φ⁻¹ +
tails) + `projection.test.ts` · `spring.ts` · `interactions.ts` (pan/zoom/glide) ·
`logger.ts` + `telemetry.ts` (observability) · `panel.ts` (settings UI) · `style.css`.
