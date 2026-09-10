# ADR-0007: Reserve and reconcile the entire review cycle

Status: Accepted

## Context

Per-invocation limits did not bound combined batches, failed attempts, quality
evaluation, and learning A/B. Missing optional usage fields disabled enforcement
of otherwise known input/output counts. Dense generated declarations could also
exhaust skeptical-verification context after successful analysis.

## Decision

Reuse the cycle runner and its private atomic artifacts. Reserve shared token and
call capacity before spawning each model-bearing child; pass tightening-only
execution ceilings without changing semantic review identity. Reconcile reported
input and output, keeping unknown usage conservatively charged across recovery.
Never add cached input or reasoning twice. Preserve stricter configured hierarchy
limits. No additional orchestrator or dependency is introduced.

For a single oversized verification candidate, progressively reduce neighboring
lines while preserving its entire claimed range. If that still cannot fit, fail
closed. Do not drop required candidates, packs, or lenses.

## Consequences

Cycles expose per-attempt usage alongside final-artifact usage; reuse is not new
spend. Unknown usage may prevent further work rather than promise free recovery.
Provider-reported usage can exceed an estimate for an in-flight request; this is
recorded as a breach and blocks further execution, not hidden as a passed gate.
Token limits cannot guarantee a remote provider's final bill.
