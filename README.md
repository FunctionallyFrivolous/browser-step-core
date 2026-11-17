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
