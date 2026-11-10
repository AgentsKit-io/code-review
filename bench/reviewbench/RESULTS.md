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

The exact Harbor command line and the dataset version come from the runner's own documentation
(https://review-bench.ai/run/) and are NOT known to the agent sandbox; they are not invented here.
Fill the placeholders `<...>` from the runner and record them in the table below.

```bash
docker build -f bench/reviewbench/Dockerfile -t code-review-rb:dev .
# Harbor invocation (operator fills in from the runner docs):
#   harbor run --dataset reviewbench@<DATASET_VERSION> --subset <private-25-pr-list> \
#     --agent-image code-review-rb:dev --env RB_DATASET_VERSION=<DATASET_VERSION> \
#     --env RB_CONFIG_MODEL=claude-sonnet-5-5 --env RB_CONFIG_VOTES=3 --env RB_CONFIG_PROFILE=full
# Reviewer credentials: factory subscription pool. Judge: only RB_HARBOR_JUDGE_KEY.
# Stop the batch near the judge's cap (see judge cost column).
```

`agent.mjs` records `RB_DATASET_VERSION` in `<out>.meta.json`, and drops findings without file/line
(the contract needs both).

## Results (fill in after the run — all pending, nothing invented)

| Field | Value |
|---|---|
| Dataset version (pinned) | _pending — pin `reviewbench@<version>` from the runner_ |
| Model / config | _pending_ |
| F1 / precision / recall (grounded) | _pending_ |
| Judge cost total / cap | _pending_ |

Leaderboard on 2026-10-30 for comparison: #1 OhMyBug 83.0, Copilot Max 75.7, Laude RevEngine (Opus 5.5) 73.3, Codex 70.2.

Per-PR table (to fill):

| PR | Model | Configuration | Duration | Comments | Judge cost |
|---|---|---|---|---|---|

False-negative categories, false-positive analysis and the 3–5 recommended changes to raise F1:
_pending the run_.
