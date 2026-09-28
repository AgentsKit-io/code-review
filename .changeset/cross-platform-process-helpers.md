---
"@agentskit/code-review": patch
---

Route local CLI spawning, process-tree termination, and Windows-sensitive path/line handling through `@agentskit/cross-platform` instead of hand-rolled `cross-spawn`, negative-pid group kills, and `shell: true` probes. `cross-spawn` is no longer a direct dependency. `npm run check` now runs `agentskit-cross-platform check` against a committed baseline so new portability hazards fail.
