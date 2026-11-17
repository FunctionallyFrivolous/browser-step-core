# Architecture

## Source of truth

OpenCascade BRep is the authoritative model. Three.js geometry is derived for rendering only and must never be used to modify or replace the BRep.

## Layers

- **Kernel (`packages/kernel`)** — owns OpenCascade initialization, BRep state, STEP I/O, topology queries, and geometric operations.
- **Model (`packages/core`)** — represents application-level bodies, faces, and edges and coordinates undoable commands.
- **Rendering (`packages/renderer`)** — turns kernel-produced tessellation into Three.js objects and maps picking results back to model topology.
- **Commands** — the only way to modify a model; commands invoke kernel operations and participate in undo/redo.
- **Applications** — viewer and future tools consume the shared packages.

## OpenCascade integration research

Research snapshot: 2026-11-17. Both candidates compile the OpenCascade Technology (OCCT) BRep kernel to WebAssembly; they differ mainly in their OCCT version, JavaScript binding surface, and build workflow.

| | OpenCascade.js | libcascade |
|---|---|---|
| **Approach** | OCCT compiled with Emscripten; generated JavaScript and TypeScript definitions expose OCCT APIs. | OCCT compiled to WebAssembly with generated TypeScript bindings; the documented toolchain can select bindings and add C++ extensions. |
| **API and lifecycle** | Broad, low-level OCCT-style API. Callers need to manage native object lifetimes and translate C++-shaped APIs into app-level operations. | Broad, low-level OCCT-style API with typed classes and documented disposable-object patterns. It still requires a project-owned facade; typed bindings do not provide application commands or model semantics. |
| **Version and ecosystem** | The project README currently identifies OCCT 7.6.2 and links to examples and applications built on the bindings. This is the more established option, but its OCCT version should be checked against required features. | The project documents tracking OCCT V8 and publishes a configurable build/toolchain. Its newer version line and build surface should be validated against a pinned release before adoption. |
| **Build and browser concerns** | Provides prebuilt builds and documents custom builds for reducing the exposed API and binary size. | Documents browser and Node use, custom/trimmed builds, and reproducible container builds. Its multithreaded browser build requires cross-origin isolation (COOP/COEP); the single-threaded path should be evaluated separately. |
| **Main tradeoff** | More examples and a longer usage history, with an older documented OCCT baseline and a lower-level binding experience. | Better-documented TypeScript and build customization, with a newer toolchain that brings more version and integration risk to validate. |

These are bindings to the same underlying kernel, not competing geometry representations. Published size figures are not directly comparable because build contents and compression differ; measure the production assets for the same feature set and compression method.

### Recommendation

Prototype libcascade first, without making it part of the production dependency graph yet. Its documented TypeScript bindings, configurable build, and current OCCT line make it the better initial fit for this TypeScript workspace. Keep the kernel boundary backend-neutral so OpenCascade.js remains an alternative if libcascade fails the browser, size, licensing, or reliability checks below.

Before selecting either candidate, pin an exact release and verify the package and generated artifacts' licenses and notices, STEP import/export, required BRep operations, and Vite/GitHub Pages loading. The comparison above is based on project documentation, not a local integration benchmark.

## Kernel boundary and data flow

1. Keep all OCCT objects and BRep mutation behind the shared kernel package; do not expose WebAssembly handles to the viewer or renderer.
2. Run expensive kernel work asynchronously, preferably in a worker. Send commands and serializable inputs to the worker; return derived mesh buffers, operation results, and topology references rather than OCCT objects.
3. Keep model edits in undoable commands. A command invokes a kernel operation, updates the application model, and invalidates derived rendering data for the changed model revision.
4. Generate Three.js meshes from the current BRep. Associate picks with topology references scoped to that revision, and refresh those references when a command changes topology.
5. Keep STEP import and export in the kernel layer. Treat serialized files as interchange, not as a substitute for the in-memory BRep or the command history.

## Prototype acceptance checks

- Load the WASM and worker assets under the deployed `/browser-step-core/` base path in supported browsers.
- Import and export a representative STEP file and compare the resulting geometry and topology.
- Exercise the required create/edit and Boolean operations, including kernel failures and invalid input.
- Verify worker responsiveness, BRep-to-mesh updates, topology picking, and undo/redo across model revisions.
- Measure compressed production assets, startup time, memory use, and repeated-operation stability.
- Review wrapper, OCCT, and generated-artifact licensing for the pinned build before distribution.

## Sources

- [OpenCascade.js repository](https://github.com/donalffons/opencascade.js/) — build approach, current documented OCCT version, examples, and license.
- [OpenCascade.js custom builds](https://github.com/donalffons/opencascade.js/blob/master/website/docs/03-app-dev-workflow/03-custom-builds.md) — selecting a custom API surface and generated artifacts.
- [OpenCascade.js file size](https://ocjs.org/docs/getting-started/file-size) — full and custom build-size discussion.
- [libcascade overview](https://libcascade.vercel.app/docs/package/getting-started/what-is-libcascade) — API coverage, OCCT version line, and build-size discussion.
- [libcascade npm quick start](https://libcascade.vercel.app/docs/package/getting-started/quick-start-npm) — browser/Node use and runtime setup.
- [libcascade calling OCCT from JavaScript](https://libcascade.vercel.app/docs/package/concepts/calling-occt-from-js) — bindings, exceptions, and native-object lifetime.
- [libcascade toolchain](https://libcascade.vercel.app/docs/toolchain) — configurable bindings, custom builds, and reproducible build flow.
