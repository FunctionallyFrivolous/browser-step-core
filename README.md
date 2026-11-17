# Browser STEP Core

A browser-based STEP model platform.

## Project structure

- `packages/core` — shared application core
- `packages/renderer` — rendering package
- `packages/kernel` — geometry-kernel package
- `apps/viewer` — Vite viewer application

## Development

Run `npm install` once, then use `npm run dev --workspace @browser-step/viewer` to start the viewer.
Run `npm run build` at the repository root to type-check the workspace and build the viewer.

## GitHub Pages deployment

In the repository's **Settings → Pages → Build and deployment**, set **Source** to
**GitHub Actions**. Do not select a branch as the source: its separate Pages
deployment can overwrite the built viewer with repository source files.

The `Deploy viewer` workflow builds the workspace and publishes `apps/viewer/dist`
on pushes to `main` or when manually dispatched. After changing the Pages source,
run the workflow again. Open the deployed page and check the browser console and
network panel for errors; the viewer should load its JavaScript from
`/browser-step-core/assets/`, not `/src/main.ts`.
