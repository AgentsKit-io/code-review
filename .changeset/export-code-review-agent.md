---
"@agentskit/code-review": patch
---

Export `createCodeReviewAgent`, `builtInLenses`, every reporter (`markdownReporter`, `sarifReporter`, `githubInlineReporter`, `githubSummaryReporter`, `scmReviewReporter`, `renderMarkdown`, `renderGithubWalkthrough`), and the associated types (`CodeReviewConfig`, `ReviewResult`, `Finding`, `ReviewPlan`, `ReviewEvidence`, `Category`, `Severity`, `Verdict`, `Lens`, `Reporter`, `ReviewTarget`, `ContextPackEvidence`, `LensExecutionStats`, `GithubCommentPolicy`) from the package root. These were never part of `src/index.ts`'s export list — a gap that predates this release — so `verification.posture`, `rules.*`, and `context.grouping` (added in 0.31) were unreachable by any external consumer despite being fully implemented; only the bundled CLI could use them internally. Found while piloting the published 0.30.18 package from a clean install.
