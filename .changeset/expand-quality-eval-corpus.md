---
"@agentskit/code-review": patch
---

Expand the semantic evaluation corpus in `quality/evals/default.json` from 6 to 20 cases (8 plain positive, 4 protected-subject positive, 8 clean) and document how to reproduce a v0.30.17 quality baseline outside the repository, per the existing `validateStudyOutputPath` design. This is the prerequisite for the release 0.31 verification work (#250, #251, #252).
