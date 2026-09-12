---
"@agentskit/code-review": patch
---

`githubInlineReporter` now fetches the PR's existing review comments before posting and drops any candidate whose line range overlaps one at or above `policy.incrementalOverlapThreshold` (default 0.6 IoU), so a second run on the same PR does not repeat a finding still standing from a previous run — the summary notes how many were skipped. `policy.routeSeverityBelow` additionally folds low-severity findings into the summary instead of posting them inline. History fetching is best-effort and never blocks posting on failure.
