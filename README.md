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
**Deploy from a branch**, select the `gh-pages` branch and `/ (root)` folder.
In **Settings → Actions → General → Workflow permissions**, allow read and write
permissions so the workflows can publish the viewer and PR previews.

The `Deploy viewer` workflow publishes `apps/viewer/dist` on pushes to `main` or
when manually dispatched, preserving active previews. The `Preview viewer`
workflow publishes a temporary URL for same-repository pull requests, updates
the PR comment when the preview changes, and removes the preview when the PR is
closed. GitHub does not grant write access to fork PR workflows, so those PRs
are built by CI but do not receive a preview.
