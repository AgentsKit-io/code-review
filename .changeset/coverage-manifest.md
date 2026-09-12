---
"@agentskit/code-review": patch
---

Add a `coverage: { totalFiles, reviewedFiles, unreviewedFiles }` field to every `ReviewResult` (single run and consolidated batch), distinct from the `incomplete` boolean: `incomplete` folds every uncertainty (budget, deadline, unverified findings, missing lenses) into one flag, while `coverage` says how many of the eligible files a run actually reviewed. The Markdown reporter now prints "N of M file(s) reviewed" instead of only "INCOMPLETE". Also add `describeCoverage` to `src/batch-coverage.ts` for the same "N of M" summary from an in-progress `BatchCoverageState`, and extend `finalCoverage`'s return with `totalFiles`/`reviewedFiles`.
