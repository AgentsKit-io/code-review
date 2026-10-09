---
"@agentskit/code-review": patch
---

A pull request that deletes a file is no longer left `INCOMPLETE`. Since #180 every removed file was marked `UNREVIEWED` ("deleted file requires diff-first review"), so any PR with a deletion exited `2` and could never complete. A deleted file is now reviewed diff-first from its patch: the removed lines, numbered by their base-file line. Its findings surface in the review summary rather than inline, because GitHub anchors inline comments on the head side, where a deleted file has no lines. A deleted file stays `UNREVIEWED` when GitHub sent no patch for it, when its path is denied, or when it exceeds the byte budget.
