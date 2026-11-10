# ReviewBench — code-review (25-PR private showcase subset)

**Status: NOT MEASURED YET.** No score is reported on purpose: the private 25-PR evaluation needs the
ReviewBench private subset, its Harbor runner and the factory's subscription model pool, none of which
are available in the agent sandbox that produced this change. No number below is invented.
Nothing was submitted to the public leaderboard and the full 219-PR set was not run.

## What exists

- `Dockerfile` — reviewer image (agentskit-review + `claude` CLI, subscription auth, no paid API key).
- `agent.mjs` — adapter: runs `agentskit-review --provider claude-cli` on one PR and writes the findings
  file of the ReviewBench agent contract, plus `<out>.meta.json` (model, votes, profile, duration, findings).
  Configuration via `RB_CONFIG_MODEL` (default `claude-sonnet-5-5`), `RB_CONFIG_VOTES` (3),
  `RB_CONFIG_PROFILE` (full), `RB_CONFIG_DEADLINE_MS` (1500000).

## Reproduce (to be run by the operator with the factory pool)

```bash
docker build -f bench/reviewbench/Dockerfile -t code-review-rb:dev .
# Then follow https://review-bench.ai/run/ (Harbor) with image code-review-rb:dev, the private
# 25-PR subset, and the Claude subscription credentials mounted from the factory pool.
# Pin the dataset version reported by the runner in the table below before the first run.
```

## Results (fill in after the run)

| Field | Value |
|---|---|
| Dataset version (pinned) | _pending — record the runner's version here_ |
| Model / config | _pending_ |
| F1 / precision / recall (grounded) | _pending_ |

Leaderboard on 2026-10-30 for comparison: #1 OhMyBug 83.0, Copilot Max 75.7, Laude RevEngine (Opus 5.5) 73.3, Codex 70.2.

Per-PR table (model, configuration, duration, comments), false-negative categories, false-positive
analysis and the 3–5 recommended changes: _pending the run_.
