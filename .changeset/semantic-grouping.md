---
"@agentskit/code-review": patch
---

Add an opt-in `context.grouping: 'semantic'` mode: one model call clusters changed files by index (paths and line counts only, never content) into context packs, for cross-file relationships the default same-basename/local-import heuristic cannot see. Only triggers above `groupingMinFiles`/`groupingMinLines` thresholds (default 4 files / 200 combined lines), and always falls back to the heuristic below threshold, on any grouping-call failure, or during `--plan`/`--dry-run` (which stays a provider-free preflight in every mode). Out-of-range or duplicate indices from the model are dropped; every real file still lands in exactly one group.
