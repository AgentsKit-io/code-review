---
"@agentskit/code-review": patch
---

Add a budget lookahead (`ReviewBudgetLedger.canAfford`) checked before a context pack is dispatched, not after: a pack that cannot possibly fit the analysis budget is now marked unreviewed for that reason directly, instead of occupying a concurrency slot and then aborting the whole run when it fails inside the real reservation — which previously discarded sibling packs' already-produced findings too. Also fix a real bug where a global deadline reached during analysis discarded every candidate finding unconditionally, even from packs that finished before the deadline fired: those findings now flow into verification as usual, where the same tripped deadline marks them `verification: 'unverified'` (surfaced per #252's fix) instead of the whole result silently going empty.
