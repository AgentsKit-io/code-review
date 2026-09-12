---
"@agentskit/code-review": patch
---

Add an optional `conservative` skeptic verification posture (`verification.posture` on `createCodeReviewAgent`) alongside the existing default `strict` one: it refutes a finding only when the evidence proves it wrong (the code is not where claimed, or a specific line directly contradicts the claim) and vetoes a configurable `verification.protectedSubjects` list (default: memory-safety, concurrency, behavioral-change, unused-parameter, linkage-consistency) before assessing correctness at all. The default stays `strict`, pending a live-provider A/B — see `docs/adr/0008-verification-posture.md`.

Also, independently of posture: a finding verification could not reach a verdict for (timeout, budget exhaustion, malformed output) is now surfaced in the result tagged `verification: 'unverified'`, instead of being silently folded into refuted findings and discarded. `incomplete` still forces the run to stop short of approval whenever this happens.
