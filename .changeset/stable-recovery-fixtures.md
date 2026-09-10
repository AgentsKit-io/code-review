---
"@agentskit/code-review": patch
---

Make packaged recovery fixtures tolerate bounded cold CLI startup before asserting provider cancellation. Keep the provider's 50 ms fault timeout and real child-exit assertions unchanged; expose early CLI errors instead of reporting an ambiguous missing PID.
