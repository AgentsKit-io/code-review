---
"@agentskit/code-review": patch
---

Add opt-in, layered per-language review rules: `createCodeReviewAgent({ rules: { enabled: true } })` resolves a checklist per file by glob (project `.agentskit-review/rules.json` → global `~/.agentskit-review/rules.json` → a built-in system checklist per language in `agents/code-review/rules.ts`), deduplicated across files sharing a language, and appended to the pack's conventions. Includes a small dependency-free glob matcher (`src/review-rules.ts` `matchGlob`, supporting `**`, `*`, `?`, and `{a,b,c}`) rather than adding a new glob library. Off by default, since enabling it changes prompt content and cost for every file.
