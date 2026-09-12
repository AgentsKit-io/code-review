---
"@agentskit/code-review": minor
---

Promote `conservative` to the default `verification.posture` on `createCodeReviewAgent`, replacing `strict`. This closes out ADR-0008's pending live A/B: run against all 20 cases in `quality/evals/default.json` (including the corpus recalibration from the previous release) through a real `codex-cli` provider, `conservative` detected 10/12 positive cases versus `strict`'s 9/12 (+8.3 points), at a precision cost of only 1.2 points (41.7% vs 42.9%), with zero false positives on clean-code cases under either posture. This meets the promotion criterion set in ADR-0008 (detection gain ≥5 points, precision drop ≤3 points).

`strict` remains fully available — pass `verification: { posture: 'strict' }` explicitly to keep the prior behavior. This is a minor version bump because it changes default review output (a caller relying on the exact prior finding set from an unconfigured `verification.posture` will see different results, typically catching more real issues at a small, measured precision cost) even though no public API signature changed.
