---
"@agentskit/code-review": patch
---

Recover lost GitHub publication acknowledgements by reconciling marked remote history, complete missing summaries on validated artifact replay, and avoid duplicate writes. Preserve completed review/matrix evidence on publication failure, reuse hash-bound successful evaluations without resetting cumulative budgets, and honor configured comment channels and semantic policy identity.

Block merges with outstanding changes-requested reviews even when the current commit checks pass; incomplete review history fails closed.
