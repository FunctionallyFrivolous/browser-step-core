# Temporary branch previews

Previews share the GitHub Pages site with production, but do not replace the
production viewer or inspector. Deploy only trusted branches: preview pages run
JavaScript on the same origin as production and are publicly accessible.

## Create and deploy a preview

1. Create a branch from the commit you want to compare, for example
   `git switch -c depth-prepass-test <commit>`, and push the branch to this
   repository. The branch must contain the viewer and inspector workspaces,
   their npm lockfile, and the usual build and typecheck scripts.
2. In **Actions → Temporary branch preview → Run workflow**, select `main` for
   **Use workflow from**. Choose `deploy`, enter the branch name (for example
   `depth-prepass-test`), and enter a preview name. The name must be 1–63
   lowercase letters, digits, or hyphens, starting and ending with a letter or
   digit. It can differ from the branch name, including for branches with `/`.
3. Run the workflow and wait for the Pages deployment to finish. Reusing a name
   replaces that preview; other previews remain in place.

For the name `depth-prepass-test`, the URLs are:

- Viewer: https://functionallyfrivolous.github.io/browser-step-core/previews/depth-prepass-test/
- Inspector: https://functionallyfrivolous.github.io/browser-step-core/previews/depth-prepass-test/inspector/

Production remains at https://functionallyfrivolous.github.io/browser-step-core/
and https://functionallyfrivolous.github.io/browser-step-core/inspector/.

## Remove a preview

Run **Temporary branch preview** from `main` again, select `remove`, and enter
the same preview name. The branch field is not needed. Wait for the deployment
to finish; deleting the source branch alone does not remove its preview.

## How it works

Pages must use **GitHub Actions** as its deployment source. The workflow builds
the selected branch with preview-specific asset paths and builds production from
`main`. Built previews are stored on the `pages-previews` branch and included in
subsequent production and preview deployments. The workflow requires permission
to write that branch and deploy to the `github-pages` environment. Do not use
`pages-previews` as the Pages source or edit it manually.
The branch build runs in a container without Actions credentials; artifacts
containing symbolic links are rejected.

Deployments share the Pages concurrency group. GitHub may replace an older
pending run with a newer pending run; check the Actions result and rerun a
cancelled request. If publishing fails after preview storage is updated, rerun
the workflow or the production deployment to publish the stored state.
