---
"@agentskit/code-review": patch
---

Split large source projections with a provider-overhead safety margin before live execution, and give multi-pack reviews an aggregate analysis budget so generated files cannot fail after only a few safe packs. Plans now fail fast when aggregate analysis demand exceeds the declared budget.
