# Edge Rendering Options

**Investigation date:** 2026-11-18

## Scope and current implementation

This report evaluates edge visibility for the current Three.js STEP viewer.
The experiment changes regular edge depth testing only; it does not introduce a
permanent rendering architecture. OpenCascade BRep remains authoritative;
Three.js meshes and lines are derived display geometry, as described in
[`architecture.md`](architecture.md#source-of-truth).

In `packages/renderer/src/index.ts`, each tessellated face is a mesh. Face
materials use transparency when opacity is below one and disable depth writing
in that case; face materials keep the default depth test and enable polygon
offset (`createFaceMaterial`). At the default 0.5 opacity, faces therefore blend
with the scene but do not add their depths to the depth buffer.

Boundary geometry is generated from face mesh boundaries and rendered with
`LineSegments2` and `LineMaterial`. The regular boundary material is currently
opaque (`transparent: false`), with depth testing enabled and depth writing
disabled. Selection highlights bypass depth testing, intentionally making
them overlays. `renderOrder` affects draw ordering, not whether a fragment
passes the depth test.

The renderer tests assert material properties, but they do not measure rendered
visibility. The browser experiment below provides qualitative evidence for one
bundled model and should not be treated as a general hidden-line correctness
test.

## Root causes

- **Depth testing controls occlusion.** With depth testing disabled, line
  fragments are not rejected when a nearer face is already in the depth
  buffer. Enabling it rejects hidden edges when nearer geometry has written
  depth; changing edge opacity or render order cannot restore that occlusion.
- **Depth writing controls what later geometry can occlude.** Translucent face
  materials in this renderer do not write depth. Even if boundary depth testing
  were enabled, those faces would not provide depth values that reliably hide
  edges behind them. Opaque faces do write depth, so the same edge material can
  appear to behave differently as face opacity changes.
- **Transparency is blended and sorted approximately.** Three.js renders
  transparent objects in a separate, sorted stage. Sorting is at the object
  level, not a globally correct order of every triangle or fragment. Intersecting
  or nested translucent faces can therefore blend differently as the view
  changes; `renderOrder` can influence draw order but cannot make that sorting
  geometrically correct.
- **Lines still have rasterized depth.** The renderer uses the wide-line
  `LineSegments2` addon rather than basic WebGL line primitives. Its line
  material participates in depth testing when enabled. Edge curves usually lie
  on face boundaries, so small depth precision differences can cause
  z-fighting or partial disappearance when depth testing is enabled without an
  appropriate coplanar bias.
- **Camera movement changes the projection and depth ordering.** It changes
  which surfaces overlap in screen space and how close their projected depths
  are. That exposes bypassed depth tests, imperfect transparency sorting, or
  coplanar precision problems; camera angle is a symptom amplifier rather than
  an independent visibility rule.

## Edge visibility experiment

The variants were exercised in Chromium's software-WebGL browser using the
bundled `apps/viewer/src/GDT_Hole_Str.step` model (one body, 12 faces). The model
was fit to the viewport, inspected at the default 50% opacity and at 100%, then
rotated to a narrow side view. These observations are qualitative and cover a
single model and a small set of views.

| Variant | Tested state | Findings |
|---|---|---|
| 1 | Edges `depthTest: true`, `depthWrite: false`; face behavior unchanged; no prepass | At 50% opacity, rear/interior edges remain visible through faces because transparent faces do not write depth. At 100%, face depth writes occlude rear edges. No obvious popping was observed in the tested views, but this does not establish stability across grazing angles or other models. |
| 2 | Same edge state; faces forced to `depthWrite: true`; temporary depth-only face prepass enabled | Rear linework around the through-hole remained visible. The face's blend appeared lighter where the prepass suppressed additional transparent-surface layers. The sample did not establish complete hidden-edge correctness; a prepass changes which transparent surfaces contribute depth and can suppress expected see-through layering. |
| 3 | Same edge state and forced face depth writes as variant 2; prepass disabled | At 50% opacity, rear linework still shows through. Face depth writes alone do not help edges already rendered before the transparent face pass. Compared with the temporary prepass, the face retained more of its transparent layering. |

Across the tested states, selecting the front face continued to show its red
outline from a rotated view. This is expected because selection highlights
remain depth-test-disabled overlays; selection visibility is therefore
independent of regular edge occlusion. The narrow-side view also exposed
closely spaced boundary lines at a face transition. More representative models
and controlled grazing-angle checks are needed to determine whether those are
actual self-occlusion artifacts or distinct model edges.

**Finding:** Variant 1 is a useful narrow improvement: it restores depth
occlusion against opaque faces, but cannot hide edges through the viewer's
default translucent faces. Variant 3 confirms that setting face `depthWrite`
alone is insufficient. The temporary variant-2 prepass did not establish
complete visibility correctness and is not retained as a rendering
architecture.

## Approaches

### A. Depth bias / polygon offset

**Expected behavior:** Keep depth testing enabled and bias coplanar faces or
edges slightly apart in depth. This can prevent z-fighting at an edge that
should be visible on its parent face. It does not by itself hide an edge behind
another face. Biasing faces away from the camera can make their boundary lines
win the depth test; bias direction and magnitude require validation for the
renderer and depth-buffer configuration.

**Performance:** Negligible additional draw cost.

**Complexity:** Low to moderate. The renderer already applies polygon offset to
face materials, but its effect must be checked with depth-tested lines.
Over-biasing causes visible lines to float and can reveal edges through nearby
surfaces.

**CAD suitability:** Useful as a precision/tuning measure, not a visibility
algorithm. It is not sufficient alone for hidden-line removal.

### B. Dual-pass rendering

**Expected behavior:** First render model faces into the depth buffer without
color, writing nearest-surface depth. Then render face colors with depth testing
but without depth writes, followed by edges with depth testing enabled and
depth writing disabled. The prepass lets edges behind a translucent face be
occluded without requiring the blended face pass to write depth. A small,
carefully tuned bias may still be needed for edges coplanar with their faces.
The face color pass still has the usual transparency-sorting limitations.

**Performance:** Adds at least one face draw pass and extra fragment work.
Usually predictable for a moderate STEP model, but large models and high
overdraw increase the cost.

**Complexity:** Moderate. Requires explicit pass ordering, depth-buffer
preservation/clearing rules, consistent visibility and clipping, and handling
of selection overlays. Transparent faces need to participate in the depth
prepass if they are intended to occlude edges.

**CAD suitability:** A practical near-term basis for depth-correct display when
all model surfaces should hide geometry behind them. It does not classify
topological or silhouette edges and does not solve transparency sorting.

### C. Visible-edge rendering

**Expected behavior:** Determine which model edges are visible from the current
view, then draw only those edges. A GPU depth-buffer test can provide a
screen-space visibility result; a fuller CAD hidden-line pipeline can classify
visible, hidden, and silhouette edges using model topology and geometry.
Correctly hidden edges disappear rather than showing through faces.

**Performance:** A GPU depth-tested approach can be efficient but depends on
the depth pass and edge count. CPU ray tests or exact geometric classification
can become expensive and must be repeated as the camera moves. GPU/CPU
acceleration and caching can reduce the cost.

**Complexity:** High for robust CAD results. It must handle tessellation
tolerance, coincident and shared edges, seams, silhouette changes with camera
position, and visibility updates during navigation. A depth prepass is a
simpler screen-space implementation, but it does not supply semantic edge
classification.

**CAD suitability:** Best long-term direction when the platform needs
engineering-grade visible/hidden lines, silhouette emphasis, or drawing output.
It can build on a depth prepass while adding BRep-aware classification.

### D. Overlay rendering passes

**Expected behavior:** Render edges after faces with depth cleared or depth
testing disabled. This guarantees legibility but draws hidden edges through
occluding geometry. A separate layer/pass makes the overlay policy explicit;
it does not improve geometric visibility unless edges are filtered separately.

**Performance:** Low implementation and runtime overhead beyond rendering the
edges, though the additional pass has setup cost.

**Complexity:** Low to moderate. Requires controlling render targets, depth
clears, and composition. As with `renderOrder`, an overlay pass alone does not
make correct visibility decisions.

**CAD suitability:** Good for selection highlights, annotations, or an explicit
x-ray mode. Poor as the default representation of visible model edges in a CAD
viewer.

## Recommendation

- **Current project stage:** Prefer **B, a depth prepass followed by a
  depth-tested edge pass**, with **A** used only to handle coplanar edge/face
  precision, as the next candidate to validate—not as an established solution.
  This single-model experiment does not justify a permanent prepass. Keep the
  tested depth-tested edge state for opaque-face occlusion, and add controlled
  overlapping-face fixtures and grazing-angle checks before choosing prepass
  depth participation for translucent faces. Keep selection highlights as an
  explicitly separate overlay if their always-visible behavior is desired.
- **Future CAD platform:** Evolve toward **C**, using the depth prepass as a
  screen-space visibility foundation and adding BRep-aware classification for
  silhouette and hidden-line semantics as product requirements justify it.
  Keep **D** for deliberate overlays and x-ray presentation; do not use **A**
  alone as a visibility solution.

## References

- [`packages/renderer/src/index.ts`](../packages/renderer/src/index.ts):
  `createGeometryGroup`, `createFaceMaterial`, and `setFaceMaterialOpacity`
  describe the current material and line configuration.
- [`packages/renderer/test/render.test.mjs`](../packages/renderer/test/render.test.mjs):
  current material assertions, including the boundary depth-test mismatch.
- [Three.js `Material` documentation](https://threejs.org/docs/pages/Material.html)
  documents `depthTest`, `depthWrite`, `transparent`, and polygon-offset
  material properties.
- [Three.js `Object3D` documentation](https://threejs.org/docs/pages/Object3D.html)
  documents `renderOrder`.
- [Three.js transparency guide](https://threejs.org/manual/#en/transparency)
  discusses the limitations of sorting transparent objects.
