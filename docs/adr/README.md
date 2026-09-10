# Architecture Decision Records

Accepted architecture decisions for AgentsKit Code Review.

| ADR | Decision |
|---|---|
| [0001](0001-bounded-provider-neutral-cli-agents.md) | Use bounded, versioned contracts for API providers and local CLI agents |
| [0002](0002-deterministic-campaign-engine.md) | Make a pure reducer the campaign state authority |
| [0003](0003-model-and-scm-adapter-boundaries.md) | Preserve AgentsKit model adapters and isolate SCM behavior |
| [0004](0004-diff-first-context-and-token-budgets.md) | Use bounded diff-first context and hierarchical budgets |
| [0005](0005-separated-safe-review-memory.md) | Separate operational state, cache, feedback, and approved knowledge |
| [0006](0006-measured-batch-completion.md) | Measure and split oversized review batches before execution |
| [0007](0007-whole-cycle-resource-accounting.md) | Reserve and reconcile batches, retries, evals, and learning within one cycle |
