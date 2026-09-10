---
"@agentskit/code-review": patch
---

Bound and reconcile whole review-cycle usage across batches, retries, quality
evaluation, and learning A/B. Enforce known input/output consumption even when
optional usage dimensions are absent, without double-counting cached tokens.

Preserve dense-file skeptical verification by reducing only neighboring context;
retain fail-closed behavior when the full claimed range still cannot fit. Run
positive, clean, and false-positive regression cases in the default live corpus.

Dispatch required CI checks natively for Changesets version PRs using GitHub's
built-in workflow token, eliminating manual close/reopen release recovery.
