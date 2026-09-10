---
"@agentskit/code-review": patch
---

Resolve the cycle CLI entry-point symlink before comparing module identity so npm/npx invocations execute instead of silently returning success. Add an actual symlink subprocess regression while retaining side-effect-free imports.
