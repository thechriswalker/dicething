# dicething

A SvelteKit app for modelling and building 3D-printable models of dice. It is
heavy on geometry and math: parametric die shapes, 2D legend engraving wired up
into 3D solids, and STL/3MF export. Everything runs client-side; the build
output is a static site.

See `README.md` for the product-level overview, feature checklist and history.

## Technology

- TypeScript, with `bun` as the development runtime.
- SvelteKit (Svelte 5, runes) building to a static site via `@sveltejs/adapter-static` (all data is client side).
- Three.js for 3D rendering, geometry, and STL output.
- `libtess` for polygon triangulation (NOT three's default earcut - see below).
- opentype.js for font handling; three's `SVGLoader` for SVG import.
- skeleton-ui (`@skeletonlabs/skeleton`) + Tailwind v4 for UI/theming.
- `@lucide/svelte` / `lucide-static` for icons.
- `fflate` for zipping multi-file exports; `xmldom` for SVG parsing off the DOM.
- Paraglide (`@inlang/paraglide-js`) for i18n; messages via `$lib/paraglide/messages`.

## Commands

Always use `bun` over `node`/`npx`.

- `bun run dev` - dev server (port 55580).
- `bun run build` / `bun run preview` - static build / preview.
- `bun run check` - `svelte-check` typecheck (run after non-trivial changes).
- `bun run lint` / `bun run format` - prettier + eslint.
- `bun run vite-node ...args` - run a standalone script with SvelteKit's
  `$lib/...` import aliases resolved. Use this for any ad-hoc geometry script.
- `bun run generate:fonts` - regenerate the built-in legend sets from fonts.

### Testing

Tests are vitest, split into three projects (see `vite.config.ts`):

- `bun run test` - the default fast suite (`client` jsdom + `server` node
  projects). Run this routinely.
- `bun run test:slow` - the `slow` project: exhaustive 3D audits (every glyph on
  every die's face shapes, etc.). **Always run this after any change to
  geometry, engraving, tessellation, or the export pipeline** - the fast suite
  will not catch most manifold regressions.

Test file naming conventions (the include/exclude globs depend on these):

- `*.spec.ts` - normal unit test (node `server` project).
- `*.svelte.spec.ts` - component test (jsdom `client` project).
- `*.slow.spec.ts` - exhaustive audit, only in `test:slow`.
- `*.manifold.spec.ts` - mesh-soundness specs (these run in the fast suite; they
  assert exported meshes are watertight + manifold).

## Project layout

- `src/routes/` - pages. Static, client-rendered: `dice/[setId]` (editor),
  `legends/`, `sandbox/`, plus `+error`/`+layout`. (Older docs mention a
  `splash`/`app` dual-route split; the routes now live at the top level.)
- `src/lib/dice/` - one file per die shape (e.g. `cube.ts`, `icosahedron.ts`,
  `trapezohedrons.ts`). Each exports a `DieModel` (see
  `src/lib/interfaces/dice.ts`). `src/lib/dice/index.ts` is the registry: it maps
  a stable id -> model and attaches `DieTags`. A startup assertion enforces that
  the map key equals `model.id` and that every die has tags.
- `src/lib/utils/` - the geometry/engraving/export engine and workers.
- `src/lib/interfaces/` - shared types and the Svelte-runes stores (`dice.ts`,
  `storage.svelte.ts`, `preferences.svelte.ts`).
- `src/lib/components/` - UI, grouped by feature (one folder each).
- `src/lib/presets/` - starter dice sets. `src/lib/fonts/` - built-in legend
  sets and the generator. `scripts/` - one-off node/bun scripts.

### Conventions

- **Die ids are `d<sides>_<shape>`** (e.g. `d6_cube`, `d20_icosahedron`,
  `d00_trapezohedron`; `00` = d%). This id is the serialisation key, so renaming
  one is a data-migration concern. (An older `<shape>_d<n>` order was migrated
  away from - don't reintroduce it.)
- Dice are modelled centred on the origin; positioning into a scene / print bed
  is done with a separate `printingTransform` (and `previewTransform` for
  thumbnails). See the `DieModel.build()` return type.
- Units are millimetres throughout.
- **Congruent faces must share an identically-oriented 2D `shape`.** The exploded
  / face-editing view lays each face out using its raw 2D `shape` (only
  translated, never re-rotated), so two geometrically identical faces look wrong
  if their shapes differ by a rotation/reflection. Build every face's 2D shape
  from an explicit, deterministic in-plane frame (e.g. "apex points +y") shared by
  all faces of that kind - including blank/cap faces. Do NOT derive face shapes
  from `orientCoplanarVertices` (or any helper that picks an arbitrary in-plane
  axis): it keeps the geometry watertight but rotates each congruent shape
  differently. Choosing a different in-plane axis pair only relabels the 2D frame,
  so the reconstructed 3D face is unchanged - the orientation is free to fix.

## Geometry & mesh pipeline (read before touching geometry)

The export goal is a **closed, manifold, degenerate-free** solid per die, so an
external slicer accepts it without repair. Several non-obvious choices exist
purely to guarantee that. The relevant files carry detailed header comments;
the highlights:

### Triangulation: libtess, not earcut (`src/lib/utils/tessellate.ts`)

`shapeGeometry()` is a drop-in replacement for `THREE.ShapeGeometry` that
triangulates with `libtess` (a port of SGI's GLU sweep-line tessellator).

- **Why not earcut** (three's default): earcut handles holes by cutting "bridge"
  edges from each hole to the outer contour. With the near-collinear/coincident
  features common in font glyphs, this produces near-degenerate slivers,
  folded/overlapping triangles and dropped vertices, leaving the engraving
  non-manifold. libtess processes every contour together under a winding rule
  with no bridging, so its boundary edges match the contour walls we extrude.
- Caps (libtess) and walls (built straight from the loop points) MUST agree on
  the boundary. `engraving.ts` strips redundant/near-collinear points
  (`RedundantPointEpsilon`) from every loop _before_ triangulation so they do.
- `unionBoundaryLoops()` is a second libtess pass in boundary-only NONZERO mode -
  it merges a self-overlapping triangle/contour "soup" into clean nested loops
  where a naive edge-walk would fragment at self-touch points.

### Self-intersecting font/SVG outlines (`src/lib/utils/path_resolve.ts`)

Most export problems trace back to fonts. Glyph contours often self-intersect
(figure-8 strokes) or overlap, with the visible fill decided by a winding rule.
`resolveShapeBoundaries()` resolves the true fill boundary of a whole shape set
while **preserving the original curve primitives** (Line/Quadratic/Cubic) rather
than flattening to polygons. Preprocess fonts/SVGs through this before building
legends.

### Mesh soundness checks (`src/lib/utils/mesh_check.ts`, `bad_edges.ts`)

- Checks operate on a **flat, NON-INDEXED position buffer** (9 numbers per
  triangle), exactly what `Builder.export()` and an STL store. `mesh_check.ts`
  has zero three.js dependency on purpose so it can run in a tiny worker
  (`mesh-check.worker.ts`). Use `toNonIndexed()` (`src/lib/utils/3d.ts`) when you
  have an indexed geometry.
- **Vertex welding must be translation-invariant.** Corners are welded by
  snapping to a tolerance grid AND scanning neighbouring cells, because a die
  laid out away from the origin (next to other dice) can otherwise have
  coincident corners land either side of a rounding boundary - making a closed
  solid read as full of boundary edges. Don't replace this with a plain
  `Math.round` grid.
- **Degeneracy is judged by geometry, not area.** A triangle is only truly
  degenerate when two corners weld to the same vertex (zero-length edge). A thin
  three-distinct-vertex sliver still has real edges that balance with its
  neighbours - dropping it would orphan those edges and open the mesh. Sliver
  detection uses triangle _height_ (perpendicular distance to the longest edge),
  which is scale-invariant; a fixed area epsilon fails because Float32 area
  flips above/below threshold depending on where the die sits in the export grid.
- **T-junction repair** (`repairDegenerateTriangles`): libtess occasionally emits
  a collinear sliver whose middle vertex M sits exactly on a neighbour's edge - a
  T-junction. The sliver is topologically load-bearing (it's the only thing
  closing that side), so deleting it cracks the mesh. Instead we _split_ every
  real triangle that has M on one of its edges (T -> two triangles), then drop
  the slivers. Result: same closed surface, no degenerate triangles.
- Hard-edge seams between adjacent faces are intentionally left unwelded by
  `mergeVertices` (their normals differ), so the weld tolerance in the checks is
  what re-recognises them as the same point.

### Rendering / workers

- Preview thumbnails render in an offscreen canvas in a worker
  (`die-previewer.worker.ts`, `offscreen.ts`). The main editor scene renders on
  the main thread (offscreen for the main scene was tried and shelved).
- Be careful with `browser`/DOM globals inside worker files - they don't have the
  same environment as components.

## Working style

- This codebase is heavily, deliberately commented where behaviour is subtle
  (especially the geometry utils). Read the header comment of a util before
  changing it; many "obvious simplifications" are bugs that were already fixed.
- Don't add narrating comments. Keep the existing explanatory comments that
  capture _why_ a non-obvious choice was made.
- After geometry/engraving/export changes: `bun run check`, `bun run test`, and
  `bun run test:slow`.
