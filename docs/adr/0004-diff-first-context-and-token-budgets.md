# ADR 0004: Diff-first context and token budgets

## Status

Accepted

Context: PRD #137, issue #138

## Decision

Plan bounded context from changed hunks, adjacent code, directly related symbols, tests, and approved rules. A normal pack uses one multidimensional analysis call; deterministic risk may add specialized analysis. Budgets and accounting cover campaign, pull request, pack, analysis, verification, cache, retry, and memory.

## Alternatives Considered

- Keep one full-source call per lens: rejected because it repeats nearly identical context.
- Send the entire repository or require persistent provider sessions: rejected because both increase exposure and operational coupling.

## Consequences

Missing context is requested explicitly and retrieved within bounds. Releases compare fixed corpus and real-canary evidence against the v0.8.0 baseline.

## Implementation

- `agents/code-review/sources.ts`: loads changed hunks and their surrounding source as review targets.
- `agents/code-review/agent.ts`: plans bounded context packs and one analysis per normal pack.
- `agents/code-review/risk.ts`: deterministic risk signals (`classifyContextPack`) that may add specialized analysis.
- `src/budget.ts`: hierarchical budget compilation (`compileReviewBudget`) and usage accounting.
