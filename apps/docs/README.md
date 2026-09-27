# AgentsKit Code Review site

This is the Fumadocs site deployed by the owner at `code-review.agentskit.io`. In Vercel, set the project root to `apps/docs`; the app builds with `npm run build` from this directory.

The product runtime remains the repository's CLI and GitHub Action. The animated home-page preview changes illustrative security/performance comments and never executes a review.

The preview uses per-example function headers and line ranges; Correctness adds one line. `node --test test/docs-review-examples.test.mjs` checks snippet syntax plus date and lookup behavior.
