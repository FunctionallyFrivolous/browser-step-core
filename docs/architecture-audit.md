# Architecture Audit and Framework Readiness Review

**Audit date:** 2026-11-18

This audit compares the current implementation with the project goals and intended boundaries in [`architecture.md`](architecture.md). It describes the tracked code as it exists today; documented target behavior is not treated as implemented functionality.

## 1. Kernel ownership

- **Current status:** The kernel package wraps libcascade, retains the loaded `TopoDS_Shape` privately, counts solids and faces, and generates typed per-face tessellation. The viewer receives mesh buffers and counts, not OpenCascade handles. See [`packages/kernel/src/index.ts`](../packages/kernel/src/index.ts) and its STEP-loading test in [`packages/kernel/test/load-step.test.mjs`](../packages/kernel/test/load-step.test.mjs).
- **Alignment:** **Strong for current import and display scope.** OpenCascade owns the retained shape and Three.js receives derived buffers. There are not yet model-editing operations to assess for mutation ownership.
- **Risks:** Tessellation runs synchronously when requested, and `faceIndex` is assigned by traversal order rather than a durable topology identifier. Heavy models may block the UI, and indices should not be assumed stable across model changes.
- **Recommended improvements:** Preserve the private kernel boundary as model operations are added. Define revision-scoped topology references, and move expensive kernel work off the UI thread before introducing substantial editing operations.
- **Priority:** **High** — keep the authoritative-model boundary intact as functionality grows.

## 2. Rendering architecture

- **Current status:** The renderer consumes typed meshes, builds Three.js face meshes and edge overlays, and disposes the prior geometry group when new tessellation is rendered. The kernel does not return Three.js objects. See [`packages/renderer/src/index.ts`](../packages/renderer/src/index.ts) (`createGeometryGroup`, `disposeGeometryGroup`, and `renderMeshes`).
- **Alignment:** **Partial.** Meshes are generated views and are replaced/disposed rather than being the source of model data. However, `createStepRenderer` combines Three.js scene creation, camera controls, pointer events, face selection, styling, and rendering lifecycle in one renderer-facing API.
- **Risks:** Renderer behavior is tied to Three.js groups and objects; the current API is not a renderer-neutral view or adapter boundary. The viewer implementation and reusable rendering primitives are not fully separated.
- **Recommended improvements:** Keep kernel output independent of Three.js, and separate reusable rendering mechanics from viewer-specific composition. Treat rendered objects and GPU resources as disposable caches of a model revision.
- **Priority:** **High** — rendering separation is foundational to supporting other applications and renderers.

## 3. Selection architecture

- **Current status:** The renderer exports face picking and selection helpers, tracks selected face indices, toggles face colors and edge highlights, and notifies the viewer through a callback. See [`packages/renderer/src/index.ts`](../packages/renderer/src/index.ts) (`updateFaceSelection`, `raycastFaceIndex`, and `createStepRenderer`).
- **Alignment:** **Partial.** Selection mechanics are reused within the renderer package, but selection state and interaction are coupled to Three.js scene objects and renderer lifecycle.
- **Risks:** A second application can reuse the renderer's behavior only by adopting its Three.js-oriented API. A bare selection model, independent of rendering and interaction, is not present; transient face indices may also be unsuitable as durable selections.
- **Recommended improvements:** Define selection state and topology-reference semantics at a shared model/application layer, with rendering adapters consuming that state to display highlights. Keep picking as an input to selection rather than making it the owner of selection state.
- **Priority:** **High** — selection is a cross-application capability and currently has a rendering-specific boundary.

## 4. Shared-package organization

- **Current status:** The npm workspace contains `core`, `kernel`, and `renderer` packages, and the viewer imports the kernel and renderer packages. The core package currently exports nothing (`packages/core/src/index.ts` contains only `export {}`). See [`package.json`](../package.json), [`packages/core/src/index.ts`](../packages/core/src/index.ts), and [`apps/viewer/src/main.ts`](../apps/viewer/src/main.ts).
- **Alignment:** **Partial.** The workspace and kernel/renderer packages establish a starting point for reuse, but the model/application core and most application-level behavior have not been implemented as shared packages.
- **Risks:** The viewer currently coordinates file loading, UI controls, kernel calls, and renderer calls directly. A second app could duplicate this coordination or couple itself to the current viewer/rendering API.
- **Recommended improvements:** Populate `core` with genuinely shared model and command abstractions when their responsibilities are established. Extract reusable selection, styling, and camera/view state where they are needed by multiple applications; keep app-specific UI and composition inside each app.
- **Priority:** **High** — package boundaries exist, but the core intended to make them useful is empty.

## 5. State management

- **Current status:** The kernel retains the current shape and counts. The renderer closure retains camera/controls, selection, shading, opacity, edge thickness, and smooth-edge visibility; the viewer owns input controls and status text. See [`packages/kernel/src/index.ts`](../packages/kernel/src/index.ts), [`packages/renderer/src/index.ts`](../packages/renderer/src/index.ts) (`createStepRenderer`), and [`apps/viewer/src/main.ts`](../apps/viewer/src/main.ts).
- **Alignment:** **Partial.** Kernel geometry is separated from rendering state and viewer UI, but there is no shared application model or explicit state store tying model revisions, selection, styling, and camera state together.
- **Risks:** State transitions are distributed across the viewer, renderer, and kernel APIs. There is no common command/history boundary or explicit invalidation contract for derived meshes and topology references when a model changes.
- **Recommended improvements:** Introduce shared model state and command interfaces as editing functionality is added. Keep camera and presentation preferences separate from authoritative geometry; associate derived rendering and selection references with model revisions.
- **Priority:** **High** — state ownership and invalidation will become more difficult to retrofit after editing workflows grow.

## 6. Future extensibility

- **Current status:** The workspace is structured to contain multiple applications and reusable packages, but only `apps/viewer` exists. The viewer directly composes the current kernel and Three.js renderer, and `core` is empty. See [`package.json`](../package.json), [`apps/viewer/src/main.ts`](../apps/viewer/src/main.ts), and [`packages/core/src/index.ts`](../packages/core/src/index.ts).
- **Alignment:** **Partial.** The repository has an extensible package layout, but the implementation has not yet demonstrated that another application can use the framework without depending on viewer-specific composition or Three.js-oriented behavior.
- **Risks:** Adding broad platform features before testing package boundaries could solidify assumptions that only work for the current viewer. Conversely, building another application without a narrow validation scope could duplicate the same tightly coupled orchestration.
- **Recommended improvements:** Build a small second-application vertical slice against shared packages, focusing on a distinct workflow and checking that it does not import from the viewer. Use friction found in that slice to refine stable shared contracts before expanding the framework.
- **Priority:** **Medium** — the current layout is promising, but extensibility remains unproven.

## Framework Readiness Assessment

| Category | Rating | Assessment |
|---|---|---|
| Kernel ownership | **Partially Ready** | The kernel owns the loaded BRep and emits derived tessellation; editing operations and revision-safe topology references are not yet in place. |
| Rendering architecture | **Partially Ready** | Three.js objects are derived and disposable, but the renderer combines rendering with camera, styling, and selection behavior. |
| Selection architecture | **Partially Ready** | Reusable helper functions exist inside the renderer package, but selection state and picking are coupled to Three.js. |
| Shared-package organization | **Partially Ready** | Kernel and renderer packages are consumed by the viewer, while the core package is empty and there is only one application. |
| State management | **Not Ready** | There is no shared application model or explicit command, state ownership, and revision-invalidation architecture. |
| Future extensibility | **Partially Ready** | The workspace supports adding apps, but reuse without depending on viewer-specific or Three.js-oriented composition has not been validated. |

### Recommendation

**B) Create the second application now and use it to validate the framework**, as a deliberately small validation exercise rather than a broad feature project. The existing kernel and renderer packages provide enough to test real reuse, while the empty core package and renderer-owned selection/presentation state make the framework boundaries uncertain. Have the second app consume shared packages only, record any duplicated or viewer-specific dependencies, and extract abstractions only where that exercise demonstrates a genuine cross-application need. This should validate the platform structure before more functionality makes the current boundaries harder to change.

## Inspector Application Findings

The inspector is a separate Vite application that consumes `@browser-step/kernel`
and `@browser-step/renderer` directly. It does not import from the viewer or use
viewer-specific controls. It validates STEP loading, body/face counts, rendering,
and face selection through the existing shared package APIs.

The viewer and inspector both coordinate the same application workflow: read a
selected file, disable the picker while loading, load it through the kernel,
render the resulting tessellation, report body/face counts, and display
selection feedback. The surrounding UI differs, so file-input handling and
presentation should remain app-owned. If more apps need this workflow, `core`
should provide a small model-loading/session abstraction that exposes a loaded
model's counts and tessellation without knowing about the DOM or Three.js.

Selection highlighting and picking are already shared through the renderer
package, but selection state remains coupled to Three.js. If applications need
selection independently of rendering, a renderer-neutral selection model is a
candidate for `core`; the inspector does not justify extracting it yet. Face
indices are traversal-based and transient, so any shared selection API must not
present them as durable topology identifiers.
