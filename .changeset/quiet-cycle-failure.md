---
"@agentskit/code-review": patch
---

Stop and drain concurrent batches before reporting a failed cycle, preventing pending batches from starting after a terminal failure. Propagate CLI cancellation to provider subprocesses and drain parallel analysis/verification calls after fatal budget errors. Add real subprocess and deterministic queue regressions.
