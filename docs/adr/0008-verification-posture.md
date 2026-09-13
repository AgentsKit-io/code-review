# ADR-0008: Conservative verification posture promoted to default after a live A/B

Status: Accepted

## Context

The skeptic's existing prompt (`agents/code-review/lenses.ts`) defaults to refuting a
finding unless it "clearly stands on its own," and a finding the skeptic could not
verify before the deadline was previously merged into the same `refuted` bucket as one
it actively disproved — both silently disappeared from the report.

`alibaba/open-code-review`'s equivalent fact-checker inverts that trade-off: it only
removes a comment for two narrow, provable reasons, and treats a set of "protected
subjects" (memory safety, concurrency, behavioral/compatibility change, unused
parameter) as a veto applied before correctness is even assessed. Its stated rationale:
keeping an incorrect comment costs a reviewer a few seconds; removing a correct one
destroys a real finding with no trace.

## Decision

Add a `conservative` posture as an alternative to the existing (now-named `strict`)
skeptic prompt, selected by `verification.posture` on `createCodeReviewAgent`'s config
(`agents/code-review/agent.ts`), with a matching `verification.protectedSubjects` list
(default: `memory-safety`, `concurrency`, `behavioral-change`, `unused-parameter`,
`linkage-consistency`). `conservative` refutes only when the cited code is absent from
the location, or a specific line directly contradicts the claim — never on a chain of
reasoning — and vetoes the protected subjects before assessing correctness at all.

Independently of posture, a finding verification could not reach a verdict for
(timeout, budget exhaustion, malformed output after every retry) is now surfaced in the
report tagged `verification: 'unverified'` instead of being folded into `refuted` and
discarded. `incomplete` is still forced true whenever any finding carries that tag, so
an unverified finding is never silently presented as a clean, fully-verified result
either.

## Live A/B result (2026-09-12)

Ran all 20 `quality/evals/default.json` cases (12 positive/protected-subject, 8 clean)
against a live `codex-cli` provider — not the credential-free fixture, which returns a
deterministic verdict regardless of posture-prompt content and so cannot distinguish
the two postures' real detection/precision (per `docs/baseline-protocol.md`). Each
posture ran the full corpus independently, same cases, same provider, same model
defaults.

| Metric | `strict` | `conservative` | Δ |
| --- | --- | --- | --- |
| Detection (of 12 positive cases) | 9/12 = 75.0% | 10/12 = 83.3% | **+8.3 pts** |
| Precision (valid / total findings) | 9/21 = 42.9% | 10/24 = 41.7% | **−1.2 pts** |
| False positives on clean cases | 0/8 | 0/8 | none |
| Severity exact-match (of detected) | 4/9 = 44.4% | 5/10 = 50.0% | +5.6 pts |

Both cases the `strict` run missed and `conservative` caught were correctness findings
(`path-traversal-read`, `off-by-one-loop`) the skeptic had refuted under `strict`'s
chain-of-reasoning latitude but that survive `conservative`'s narrower refutation bar.
Neither posture caught `unused-required-parameter` or `memory-leak-event-listener` —
both protected subjects the skeptic vetoes before assessing correctness at all under
either posture, so this A/B does not bear on whether the veto itself is well-calibrated,
only on refutation behavior for findings the veto lets through.

Applying the stated promotion criterion (precision drop ≤3 points, detection gain ≥5
points): detection gained 8.3 points (exceeds the 5-point bar) while precision dropped
1.2 points (well under the 3-point limit), with zero false-positive regression on clean
code. **The criterion is met — `conservative` is promoted to the default.**

## Decision (updated)

`verification.posture` on `createCodeReviewAgent`'s config now defaults to
`conservative` instead of `strict`. `strict` remains available and unchanged for a
caller that explicitly opts back into it. This is the only behavior change from this
ADR's original (additive) decision below — everything else stands as originally
written.

## Consequences

Both postures remain available, behind the same config flag — a caller that pins
`posture: 'strict'` keeps today's exact prior behavior. A caller that does not set
`verification.posture` at all now gets `conservative`'s narrower refutation bar and
protected-subject veto instead of `strict`'s, per the measured result above: modestly
higher detection, negligibly lower precision, no new false positives on clean code. An
unverified finding still always reaches the report (marked), which can raise finding
counts for runs that previously hit the verification deadline — this is the intended
trade-off (nothing real disappears silently) and is why `incomplete` already covered
this case.
