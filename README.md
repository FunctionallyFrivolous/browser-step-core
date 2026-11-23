# Browser STEP Core

A browser-based STEP model platform.

## Project structure

- `packages/core` — shared application core
- `packages/renderer` — rendering package
- `packages/kernel` — geometry-kernel package
- `apps/viewer` — Vite viewer application
- `apps/inspector` — minimal Vite STEP inspection application

## Development

Run `npm install` once, then use `npm run dev --workspace @browser-step/viewer` to start the viewer.
Use `npm run dev --workspace @browser-step/inspector` to start the inspector.
Run `npm run build` at the repository root to type-check the workspace and build both applications.

## Shared view state

`ViewStateModel` from `@browser-step/core` stores camera projection, position,
target, orientation, scale, and clipping independently of the renderer. Its snapshots can be
updated with `setState`, observed with `subscribe`, and saved, restored, or
deleted as named in-memory bookmarks. Bookmarks are not persisted. The viewer
synchronizes this state with camera navigation, projection changes, and fitting.
Its **Save View** button replaces the saved view, and **Revert to Saved View**
restores it. The initial saved view is captured after the first model is fitted.

## GitHub Pages deployment

In the repository's **Settings → Pages → Build and deployment**, set **Source** to
**GitHub Actions**. Do not select a branch as the source: its separate Pages
deployment can overwrite the built viewer with repository source files.

The `Deploy apps` workflow builds both applications and publishes the viewer at
the Pages root and the inspector at `/inspector/` on pushes to `main` or when
manually dispatched. The inspector is available at
`https://functionallyfrivolous.github.io/browser-step-core/inspector/`. After
changing the Pages source, run the workflow again. Open the deployed page and
check the browser console and network panel for errors; the viewer should load
its JavaScript from `/browser-step-core/assets/`, not `/src/main.ts`.
