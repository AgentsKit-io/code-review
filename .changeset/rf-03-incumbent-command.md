---
"@agentskit/code-review": minor
---

New `agentskit-incumbent-review <owner/repo> <number>` command (`mvp:RF-03`): the incumbent line reviewer as an executable for `run-reviewer-benchmark --incumbent-cmd`. It prints `{"findings":[{file,line,title}],"costUsd"}` and exits non-zero on any failure, so an errored PR is never scored as clean.
