---
"@agentskit/code-review": minor
---

Add a deterministic end-to-end review cycle with aggregate preflight, replay,
live canary and labelled quality evaluation, crash-safe batch resume, immutable
quality matrices, provider token evidence, and guarded publish/merge actions.

Load only explicitly approved, bounded review rules from self-hosted AgentsKit
memory and prove their effect with a live memory-on/memory-off quality canary.

Reduce Codex CLI context waste by excluding user configuration and sending only
changed-file context while preserving the unified patch for introduced-defect
validation. Publish only from merged Changesets version pull requests.
