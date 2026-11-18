# Persistence Architecture

## Goals and boundaries

Persist a model document so it can be reopened with its application metadata,
selection, styling, view, and construction geometry. OpenCascade BRep remains
the authoritative geometry in memory. Three.js meshes, edge overlays, and
other render data are derived caches and are never persisted as model geometry.

STEP is the geometry exchange payload, not the complete application document.
It does not by itself provide this application's document identity, durable
topology references, presentation state, or a reliable contract for restoring
those items after a round trip. Keep persistence behind shared core/kernel
interfaces; applications may own UI and user preferences, but should not
implement their own geometry or topology serialization.

This is a target design, not an implemented format. It does not introduce a
parametric history tree or make unsupported STEP metadata mechanisms part of
the contract.

## Recommended document format

Use a versioned `.bscad` project bundle: a ZIP container with a JSON manifest
and separate STEP payloads. Keep each payload independently identifiable so
the manifest can bind application state to the exact geometry it describes.

```text
project.bscad
├── manifest.json
├── geometry/model.step
└── geometry/construction.step   # optional
```

The manifest should contain:

- A format identifier and major/minor schema version.
- A persistent document UUID and human-readable document name.
- Payload paths, media types, byte lengths, and SHA-256 digests.
- Application metadata, topology identity records, and optional selection,
  styling, and view-state sections.
- For each topology-dependent section, the identity-map version and the
  corresponding geometry payload digest.

The manifest is UTF-8 JSON with finite numeric values and bounded, validated
paths. Payload paths must be relative to the bundle and must not escape it.
Writers should create a complete new bundle and replace the destination only
after all entries are written successfully. Readers validate the container,
schema, payload digests, and references before applying state. Unknown
non-critical manifest fields should be preserved when a document is rewritten
where practical; unknown major versions or required features should fail
clearly rather than be silently discarded.

The manifest and payloads form one logical save. Do not silently restore state
from a manifest whose digest does not match the STEP file. A digest proves
which payload the manifest refers to; it does not identify a face or prove that
topology identity can be recovered.

## Persisted data

### STEP geometry

Store the primary model as a STEP file produced by the kernel's STEP writer.
On open, the kernel imports it into OpenCascade and that resulting BRep becomes
the live authoritative model. Do not store Three.js geometry or tessellation:
regenerate them from the imported BRep and invalidate them whenever its
revision changes.

Bind topology identity records and topology-dependent state to the SHA-256
digest of the exact STEP bytes. The kernel must provide a supported mechanism
to serialize and resolve opaque topology identities across export/import. Do
not use traversal indices, mesh order, triangle data, or geometric-nearest
heuristics as durable identity. If the selected kernel cannot reliably
round-trip those identities, selection and entity-specific styling cannot be
restored safely; report them as unresolved or omit them rather than attaching
them to a potentially different entity.

Standalone `.step` and `.stp` files remain supported as geometry-only imports.
Without a project manifest, assign a new document identity and use defaults for
application state. Never claim that transient face indices from a prior load
were restored.

### Application metadata

Store document-level application metadata in the manifest: display name,
document UUID, schema/feature identifiers, and optional user-defined
properties. Keep geometric facts such as shape and topology in the BRep, not
as duplicated manifest data. Treat units and coordinate systems from STEP as
authoritative; any manifest copy is descriptive and must be checked against
the imported payload.

Application-specific metadata should be namespaced and versioned so one
application can retain fields written by another. Metadata must not contain
executable content.

### Selection state

Persist selection as a set of opaque topology references (document identity,
entity kind, and stable entity ID), never as current `faceIndex` integers.
Selection is optional, user-interface state rather than geometry. On load,
restore it only after the payload digest matches and the kernel resolves every
reference against the imported BRep. If a reference is missing, ambiguous, or
stale, omit that selection and expose an unresolved-state warning; do not
substitute another face. A geometry-only STEP load starts with empty selection.

### Styling state

Persist presentation overrides separately from BRep geometry. Define a
renderer-neutral style schema for document defaults and optional per-entity
overrides, such as face color, visibility, or line treatment. Entity overrides
use the same durable topology identities and payload binding as selection.
Renderer-specific objects, material instances, and GPU resources are not
serialized; adapters translate style values into the active renderer.

If a style references an unresolved entity, retain it as unresolved metadata
when possible, but do not apply it to a guessed entity. Include schema version
and explicit color/opacity representations so values do not depend on a
renderer's defaults.

### View state

Persist view state independently from model geometry and selection. A view
snapshot should capture projection, camera position and target, camera scale
or vertical span, and clipping range. Allow named bookmarks and, if the
application supports multiple viewports, key snapshots by a stable viewport
role rather than a runtime renderer object.

Validate finite vectors, valid projection values, positive scale and near
plane, and a far plane greater than the near plane before applying a snapshot.
View state is a presentation preference: invalid or unsupported state should
fall back to the application's default view without preventing geometry from
opening.

### Construction geometry

Construction geometry (for example, reference planes, axes, points, and curves)
is distinct from committed model solids and must not be silently fused into
the primary shape. Persist its geometric representation in the optional
`geometry/construction.step` payload when the kernel can round-trip the
entities and their roles. Store per-entity IDs, construction type, names,
visibility, and associations in the manifest, bound to that payload digest.

If a construction entity cannot be represented faithfully in STEP, the format
must use a versioned, renderer-neutral parametric or analytic record with
explicit units and coordinate frame, then reconstruct it through kernel-owned
code. Do not store it only as display meshes. Keep the distinction between
reference geometry and editable/committed BRep explicit so reopening cannot
change model topology by treating construction entities as solids.

## Load and save behavior

1. Read and validate the bundle and manifest version before allocating kernel
   resources; reject unsafe paths, malformed data, and unreasonable payload
   sizes.
2. Verify each payload digest, then import primary STEP geometry through the
   kernel. The geometry import must succeed before document state is replaced.
3. Resolve topology identities against the exact imported payload. Restore
   selection and entity styles only for identities that resolve uniquely.
4. Import construction geometry separately and restore it only when its
   payload and entity-role metadata validate.
5. Apply validated view state and metadata, using safe defaults for optional
   sections that are absent or invalid.
6. On save, write consistent geometry payloads and their matching identity
   records first, calculate digests, then write the manifest and finalize the
   bundle. Save must not report success for a partial or internally mismatched
   document.

Loading should be transactional from the application's perspective: if
required geometry is invalid, keep the currently open document unchanged.
Optional presentation-state failures should be surfaced but must not corrupt
or discard valid geometry.

## Topology changes and compatibility

Topology references are valid only for the geometry payload and identity map
that created them. Topology-changing commands must provide explicit lineage
for unchanged, split, merged, and deleted entities. Save the updated geometry,
identity map, and topology-dependent state as one consistent revision. A
reference with no unique continuation becomes stale or unresolved; never
rebind it by face index.

The format version governs manifest structure, while payload digests govern
which geometry state references describe. A future migration may update a
manifest schema only when it can preserve meaning. If a migration cannot
resolve topology identity, it must clear or mark affected selection and
entity styles unresolved rather than invent a mapping. Older geometry-only
STEP files remain importable with default application state.

## Implementation sequence

1. Define kernel contracts for STEP export/import and durable topology
   identity round trips; validate identity recovery on representative STEP
   files before persisting entity references.
2. Define the manifest schema, bundle reader/writer, and validation rules.
3. Add geometry-only project save/open, keeping replacement transactional.
4. Add metadata and renderer-neutral styling, then optional selection and view
   state restoration.
5. Add construction geometry as a separate payload or a kernel-reconstructed
   analytic record, with round-trip tests for roles and associations.
6. Test corruption, unsupported versions, missing manifests, mismatched
   digests, unresolved references, and reopen/save cycles before promising
   durable application state.
