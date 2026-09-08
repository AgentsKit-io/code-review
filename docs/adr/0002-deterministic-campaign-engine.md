# ADR 0002: Deterministic campaign engine

## Status

Accepted

Context: PRD #137, issue #138

## Decision

Keep the engine inside the existing package. A pure reducer is the only authority for campaign and pull-request state transitions. Effects, atomic persistence, leases, checkpoints, and replay are separate. Orca invokes one command; models perform semantic analysis only.

## Alternatives Considered

- Continue orchestration in an external LLM: rejected because workflow state and retries would remain nondeterministic.
- Adopt a workflow framework or event-sourcing service now: rejected because the package can meet the contract with a reducer and atomic local records.

## Consequences

The current procedural cycle is replaced incrementally. Every discovered pull request must end in an explicit terminal state, and completed work must survive resume.
