# ADR-0006: Measure batch invocations before execution

Status: Accepted

## Context

Fixed file-count batches could exceed token capacity, including when one generated API document exceeded an entire invocation. Suppressing the aggregate error postponed deterministic failures until after live provider work.

## Decision

The CLI and campaign preflight share one planner. Each candidate is measured with the same agent preparation used by execution. Oversized groups split by file, then by context-pack identity for a single large file. A pack that cannot fit remains an explicit blocker. Planning reuses one in-memory source snapshot, with no provider calls.

Optional `packIds` bind partial-file batches to their exact source preparation. Artifacts, canary validation, cache identity and consolidation must preserve those IDs. All planned batches are required; repeating a file across packs does not multiply the file-coverage denominator. Existing whole-file batches retain their shape.

Verification groups are also measured before invocation and divided when necessary. An unreviewable single candidate remains unverified and cannot authorize approval. GitHub content recovery is limited to one retry at the identical immutable revision.

## Consequences

Batch size is a maximum, not a guarantee of capacity. Known source and budget failures are discovered before model work. Model output, provider availability and runtime cost remain measured runtime outcomes; preflight cannot promise they will succeed. Planning adds deterministic local work but avoids repeated source downloads within an invocation.

Quality reporting must distinguish intentionally skipped PRs from failed reviews and use provider-call denominators for provider-call waste. Blocked cycles still emit a current matrix with unmeasured areas, and running campaigns replace stale report pointers. Local study matrices remain outside the package.
