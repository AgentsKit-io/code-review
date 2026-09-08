# ADR 0003: Model and SCM adapter boundaries

## Status

Accepted

Context: PRD #137, issue #138

## Decision

Keep AgentsKit `AdapterFactory` as the model boundary and add reliability and capability handling around it. Define one internal SCM contract for discovery, diffs, review state, publication, readiness, and merge. GitHub is its first implementation; GitLab is not advertised until it passes the same contract tests.

## Alternatives Considered

- Add a second model abstraction: rejected because it duplicates AgentsKit.
- Split providers or SCM adapters into new packages: rejected because one package with internal boundaries is sufficient.

## Consequences

Provider-specific and GitHub-specific behavior cannot leak into the deterministic engine. New implementations reuse the same contracts and tests.
