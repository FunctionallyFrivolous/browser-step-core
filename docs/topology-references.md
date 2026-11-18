# Topology References

## Current implementation

`LibcascadeKernel.getTessellation()` walks the loaded shape's faces with
`TopExp_Explorer` in `TopAbs_FACE` traversal order. It assigns a zero-based
`faceIndex` to each explored face and includes that value with each emitted
`TriangleMesh`. A face that has no usable triangulation can therefore leave a
gap in the indices of the returned meshes. The kernel separately counts faces
by traversing the shape; neither count nor index is a persistent identity.

The renderer copies `faceIndex` into each Three.js face mesh and its edge
objects. Raycasting returns the hit mesh's index, and the renderer keeps
selection as a `Set<number>` of those indices. Re-rendering replaces the
geometry and clears selection. `ModelSession` increments a numeric revision
after a successful STEP load, but that revision is not currently attached to
face picks or selection.

The OpenCascade `TopoDS_Shape` remains private to the kernel. Tessellation and
Three.js objects are derived views; the BRep is authoritative. The current
workflow loads STEP files but does not implement model editing or save/export.

## Limitations and risks

- Traversal order is an enumeration detail, not a promise that a face keeps
  the same index after a reload, re-import, kernel change, or topology-changing
  operation. An index can silently resolve to a different face.
- An index is meaningful only in the mesh set that produced it. It has no
  model identity or revision, so stale values cannot be detected by the
  renderer-neutral model layer.
- A `faceIndex` is not a returned-mesh array position: faces without emitted
  triangulation can create gaps.
- STEP is an interchange format, not a repository-defined store for
  application selection state. Saving the integer beside a STEP file would
  not make the selection durable.
- A geometric fingerprint or nearest-face heuristic may help suggest a
  correspondence after reload, but can collide for symmetric or repeated
  geometry. It must not silently establish identity.

## Proposed solution

Introduce an opaque, serializable topology reference in the shared model/kernel
boundary. Its initial contract should include:

```ts
interface TopologyReference {
  documentId: string;
  revision: number;
  kind: "face";
  id: string;
}
```

`documentId` identifies the loaded model document, `revision` scopes the
reference to one topology state, and `id` is an opaque identifier assigned by
the model/kernel layer. The renderer must not construct IDs from traversal
order, triangle data, or Three.js objects. The kernel keeps any mapping from
these IDs to OpenCascade topology private.

As a compatibility bridge, tessellation can carry both the existing
`faceIndex` and a `faceRef`. Keep `faceIndex` only as a transient lookup within
that tessellation/revision; use `faceRef` at application boundaries. This
contract is a design sketch, not an implementation or a claim that the
current kernel can already issue persistent IDs.

References are valid only for their stated revision. Each topology-changing
command should return an explicit mapping from input references to resulting
references, describing unchanged, split, merged, and deleted entities. A
reference with no unique continuation becomes stale or ambiguous and must be
reported as such, rather than rebound by index or heuristic. Commands that do
not change topology may retain references if they preserve the same revision.

For persistence across reloads, the application will need a document manifest
alongside the STEP data (or an equivalent format with verified metadata
support). It should store document identity, the STEP payload fingerprint,
and the reference-to-topology identity data needed by the kernel to resolve
references after import. A matching file fingerprint only verifies the file;
it does not identify an individual face. Reload must use a supported identity
mapping, and report a reference as unresolved if that mapping is missing or
ambiguous. STEP-only files without that metadata cannot promise restoration of
selection. Validate any chosen kernel naming or metadata mechanism against
round trips before relying on it.

## Impact on selection

Picking still starts from the rendered mesh, but the renderer maps the picked
mesh to its `TopologyReference` and returns that reference rather than treating
the traversal index as selection state. A renderer-neutral selection model can
then store references, associate them with a model revision, and notify the
renderer to highlight matching faces. Rendering remains a derived view and
does not own durable selection identity.

On a new revision, selection is reconciled using the command's topology
mapping. References that cannot be continued are removed or surfaced as stale;
they are never applied to a different face just because it has the same
integer index. The current behavior of clearing selection on a full mesh
replacement is a safe interim fallback.

## Impact on save/load

Selection persistence should serialize topology references, not
`faceIndex` values. Saving a model document must preserve the identity metadata
and tie it to the exact STEP payload. On load, the kernel resolves references
against the imported BRep before the application restores selection. A
missing, mismatched, or ambiguous identity map means selection cannot be
restored safely; the UI should clear it or show it as unresolved.

This requires a document-level save/load format and a tested identity mapping
strategy; neither is implemented today. The design must also define how to
handle legacy STEP files with no manifest.

## Impact on future model editing

Topology references give commands stable inputs within a revision and a
contract for returning references after edits. Commands become responsible for
reporting topology lineage and invalidating derived tessellation for the new
revision. Undo and redo must restore or reproduce the corresponding revision
and its reference mappings, rather than assuming old indices still apply.

This approach does not promise that arbitrary edits preserve a face's identity:
splits and merges are real topology changes and may require caller policy or
user confirmation. Keeping that uncertainty explicit prevents selection,
annotations, and future constraints from silently attaching to the wrong
geometry.
