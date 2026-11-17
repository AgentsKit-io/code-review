# Dogfood declaration

The factory line uses this tool as its own pull-request reviewer, in shadow mode (comments are advisory and never block a merge). The owner decision is recorded here so the claim is measurable.

- **Declaration:** every PR merged into a repository the factory line operates gets one code-review run in shadow mode.
- **Metric:** share of merged PRs in the repository that got a code-review run.
- **Target:** 100% of merged PRs over a rolling 7-day window.
- **Source of the count:** shadow-mode run reports compared with the list of merged PRs (see `docs/shadow-week-protocol.md`).
- **Decision:** approved by the product owner via the factory PM (shadow-mode dogfood, measurable by merged-PR coverage).
