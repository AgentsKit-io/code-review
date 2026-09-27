---
"@agentskit/code-review": patch
---

An incomplete review is published without the idempotency marker, so a later run at the same head reviews it again instead of printing `SKIPPED: already reviewed` without the requested `--result`.
