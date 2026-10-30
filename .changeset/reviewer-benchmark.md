---
"@agentskit/code-review": minor
---

Add the reviewer benchmark: a 38-PR labelled dataset of real AgentsKit-io PRs, scoring and entry criterion (bugs found, false positives, cost, latency) against the line's incumbent reviewer, `scripts/run-reviewer-benchmark.mjs` to run it each release, and the `agentskit-shadow-review` wrapper for the line's shadow mode. The first run is `BLOCKED` (incumbent not reachable), so the switch stays off.
