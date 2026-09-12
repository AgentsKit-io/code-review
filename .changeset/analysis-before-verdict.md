---
"@agentskit/code-review": patch
---

Require an `analysis` field before the decision it explains in the skeptic's and the batched multidimensional lens's structured tool calls: `submit_verdicts` now declares `analysis` before `refuted`, and `submit_batched_findings` declares `analysis` before `findings`. Field declaration order is the JSON Schema property order sent to the provider, so the model works through its reasoning before it commits to a verdict or a finding list, instead of deciding first and rationalizing after. The shared ACP review envelope (`src/acp-cli-adapter.ts`, used by the grok-cli and opencode-cli/headless providers) accepts and requires the same field in its multidimensional branch.
