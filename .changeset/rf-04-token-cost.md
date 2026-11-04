---
"@agentskit/code-review": patch
---

Reviewer benchmark records input and output tokens of both reviewers and prices them with one versioned per-model table (`quality/benchmark/prices.json`); a completed PR with no measured cost blocks the report instead of showing zero (`mvp:RF-04`).
