---
"@agentskit/code-review": minor
---

New `agentskit-line-review` command (`mvp:RF-10`) decides the factory line's review stage with Code Review and fails closed. It decides only when the shipped benchmark report is `PASS`. A failed or incomplete review never approves: it falls back to the incumbent, or blocks with `AGENTSKIT_LINE_ON_FAILURE=block`. With `AGENTSKIT_LINE_RECORD` every decision is appended to a log.
