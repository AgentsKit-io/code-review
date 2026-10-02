---
"@agentskit/code-review": patch
---

Use `@agentskit/net` for GitHub retry, per-attempt timeout, and bounded response-body handling. GETs now honor bounded `Retry-After` and jittered backoff; write reconciliation and the single-attempt mutation policy remain intact.
