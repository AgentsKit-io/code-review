---
"@agentskit/code-review": patch
---

Codex lenses send the review prompt over stdin instead of as a command-line argument, so reviewing a large file no longer fails on Windows with `spawn ENAMETOOLONG`.
