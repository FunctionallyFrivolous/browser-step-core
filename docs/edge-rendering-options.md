# Edge Rendering Options

**Investigation date:** 2026-11-18

## Scope and current implementation

This report evaluates edge visibility for the current Three.js STEP viewer. It
does not change rendering behavior. OpenCascade BRep remains authoritative;
Three.js meshes and lines are derived display geometry, as described in
[`architecture.md`](architecture.md#source-of-truth).

In `packages/renderer/src/index.ts`, each tessellated face is a mesh. Face
materials use transparency when opacity is below one and disable depth writing
in that case; face materials keep the default depth test and enable polygon
offset (`createFaceMaterial`). At the default 0.5 opacity, faces therefore blend
with the scene but do not add their depths to the depth buffer.

Boundary geometry is generated from face mesh boundaries and rendered with
`LineSegments2` and `LineMaterial`. The regular boundary material is currently
opaque (`transparent: false`), but disables both depth testing and depth
writing. It is consequently drawn without regard to intervening face depth,
which explains edges appearing through or in front of faces. Selection
highlights also bypass depth testing, intentionally making them overlays.
`renderOrder` affects draw ordering, not whether a fragment passes the depth
test.

There is a source/test mismatch to resolve before treating tests as a rendering
contract: `packages/renderer/test/render.test.mjs` currently expects the regular
boundary material to have `depthTest: true`, while `createGeometryGroup` sets it
to `false`. This report describes the implementation, not that assertion.

## Root causes

- **Depth testing controls occlusion.** With depth testing disabled, line
  fragments are not rejected when a nearer face is already in the depth
  buffer. Changing edge opacity or render order cannot restore that occlusion.
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
  precision. It addresses the immediate visibility problem without requiring a
  BRep edge-classification system. Keep selection highlights as an explicitly
  separate overlay if their always-visible behavior is desired. Treat
  transparent face color sorting as a separate limitation.
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
