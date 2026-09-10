---
"@agentskit/code-review": patch
---

Bound and reconcile whole review-cycle usage across batches, retries, quality
evaluation, and learning A/B. Enforce known input/output consumption even when
optional usage dimensions are absent, without double-counting cached tokens.

Preserve dense-file skeptical verification by reducing only neighboring context;
retain fail-closed behavior when the full claimed range still cannot fit. Run
positive, clean, and false-positive regression cases in the default live corpus.

Start required CI checks natively for Changesets version PRs using GitHub's
built-in workflow token to authorize workflow execution only for the verified
bot-authored version branch and current SHA. Eliminate manual close/reopen
recovery and duplicate workflow-dispatch runs; normal PR checks still gate merge.

Synchronize the package lockfile's root version during native Changesets
versioning and reject mismatched package/lock metadata in the release checks.
