# ADR-0008: Optional conservative verification posture, default unchanged pending a live A/B

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

**The default stays `strict`** — this implementation does not flip it. The stated
promotion criterion (precision drops at most 3 points, detection rises at least 5
points on `src/quality-matrix.ts`'s 14-area matrix) needs a genuine live-provider A/B:
the credential-free fixture harness this repository's `quality:matrix`/
`evaluate-quality.mjs` is built around returns a deterministic verdict regardless of
posture-prompt content (per `docs/baseline-protocol.md`, fixtures "prove deterministic
fail-closed behavior," not semantic quality), so it cannot distinguish the two
postures' real detection/precision. This implementation session has no live-provider
credentials and no standing authorization to spend against one, so it does not fabricate
an A/B result. A maintainer with provider access should run
`quality:matrix` with both postures against `quality/evals/default.json`'s 12
positive/protected-subject cases, apply the promotion criterion above, and update this
ADR (and the `verification.posture` default) with the actual outcome.

## Consequences

Both postures are available today, behind a config flag that defaults to today's
behavior — this is additive, not a behavior change for existing callers. A caller that
opts into `conservative` accepts that it has not yet been measured against this
repository's own quality bar; that is documented in the config's own doc comment, not
only here. An unverified finding now always reaches the report (marked), which can
raise finding counts for runs that previously hit the verification deadline — this is
the intended trade-off (nothing real disappears silently) and is why `incomplete`
already covered this case.
