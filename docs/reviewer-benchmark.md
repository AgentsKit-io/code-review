# Reviewer benchmark

Gate for making Code Review the factory's review stage. The labelled PR set lives in `quality/benchmark/prs.json`; the scoring is in `src/reviewer-benchmark.ts`; the runner is `scripts/run-reviewer-benchmark.mjs`. Run it on every release.

## Status

Decision on 2026-10-30: **BLOCKED, so the entry criterion is not met and the factory's review stage stays on the incumbent** (the switch is off; shadow mode does not start). The report is [`reviewer-benchmark-report.md`](reviewer-benchmark-report.md) (JSON: `quality/benchmark/report.json`).

- Code Review ran on all 38 PRs: 27 completed, 11 ended incomplete (exit 2: deadline or provider failure; reruns are needed). On the 27 completed PRs it found 8 of the 16 known bugs and reported 118 findings matching no known bug.
- The incumbent was **not run**: the line reviewer is the `review` stage of the private factory-line repository, which this repository's automation cannot reach, and no standalone executable of it exists. Its 38 runs are recorded as errors, which is what makes the decision `BLOCKED` rather than `FAIL`. Run it with `--incumbent-cmd` from a machine that has it.
- Cost is **not measured**: the run used `claude-cli`, which reports no token usage, so every cost shows 0.00. The Anthropic API provider was rejected (HTTP 401) with the credential available to the run. A cost comparison needs an API-provider run (`AGENTSKIT_SHADOW_PROVIDER=anthropic`, `AGENTSKIT_SHADOW_USD_PER_MTOK`).
- "False positives" is an upper bound: a finding counts as false when it matches none of the bugs that were later fixed, so real defects nobody fixed are counted against the reviewer. The incumbent is scored the same way, so the comparison stays fair.
- Only AgentsKit-io repositories are in the set (code-review, harness, doc-bridge); NoxCodeSolutions repositories were not reachable from this run.

## Dataset

`quality/benchmark/prs.json`: 38 merged AgentsKit-io PRs, 22 `buggy` and 16 `clean`. A `buggy` PR is one whose merged code was later corrected by a fix PR: each bug lists `file`, `line` (in the reviewed PR's version of the file, from `git blame` of the lines the fix replaced), `lineTolerance`, a `note`, and `fix` (the fix PR number and commit that proves it was real). A `clean` PR is a feature PR that no later fix PR in the same repository touched (never the origin of any blamed line of a `fix:` commit). The set was mined from `fix:` commits in code-review, harness and doc-bridge; PRs are added by annotating real PRs, never by invention. The report is `BLOCKED` until the set has 30 PRs with both labels.

## Run

```bash
npm run build
node scripts/run-reviewer-benchmark.mjs --incumbent-cmd ./path/to/line-reviewer \
  --provider claude-cli --usd-per-mtok 5 --output report.json --markdown report.md
```

An external reviewer command is run as `<executable> <owner/repo> <number>` (no shell) and prints `{"findings":[{"file","line","title"}],"costUsd":0}`. Without `--candidate-cmd` the built-in CLI reviews each PR with `--pr` (needs `GITHUB_TOKEN`; provider keys come from the environment, never from arguments). Cost for the built-in reviewer is `tokensUsed` times `--usd-per-mtok`.

## Entry criterion

`PASS` needs: at least as many real bugs found as the incumbent, strictly fewer false positives (any finding matching no known bug, and every finding on a clean PR), and cost at most 1.2x the incumbent. Any errored PR makes the report `BLOCKED`. The exit code is 2 unless `PASS`.

## Running on the line (shadow mode)

The incumbent is the `review` stage of the factory line (`reviewPrompt` in `packages/factory-line/src/prompts.ts`, private repository). The comparison runs it on the line through its shadow mode (`shadow-review.ts`, enabled per repository by `shadowReview` in `line.json`), which comments and does not decide.

`scripts/shadow-review.mjs` (also the `agentskit-shadow-review` bin) is the Code Review side. Shadow mode runs it with the PR's checkout as the working directory and reads the **last line of stdout**: `{"comment":"<review markdown>","costUsd":0,"findings":[{"file","line","title"}]}`; it reviews the files changed against `AGENTSKIT_SHADOW_BASE` (default `origin/main`) and exits 0 for a completed review, with or without findings. Given `<owner/repo> <number>` it reviews that PR instead, which is how the benchmark runner calls it (`--candidate-cmd`). Configuration is environment only: `AGENTSKIT_SHADOW_PROVIDER`, `AGENTSKIT_SHADOW_MODEL`, `AGENTSKIT_SHADOW_MODE`, `AGENTSKIT_SHADOW_CONFIG` (a larger budget for big PRs), `AGENTSKIT_SHADOW_USD_PER_MTOK`; keys never appear in arguments or output.

Reproduce the Code Review half of the report:

```bash
export GITHUB_TOKEN=... AGENTSKIT_SHADOW_PROVIDER=claude-cli AGENTSKIT_SHADOW_MODE=trusted-local \
  AGENTSKIT_SHADOW_CONFIG=./bench-config.json   # {"target":{"repository":"o/r"},"review":{"maxTokens":900000,"deadlineMs":1800000},"memory":{"enabled":false}}
node scripts/run-reviewer-benchmark.mjs --incumbent-cmd <line reviewer executable> \
  --candidate-cmd ./scripts/shadow-review.mjs --concurrency 6 --output quality/benchmark/report.json --markdown docs/reviewer-benchmark-report.md
```

## After a pass

Not reached: the decision is `BLOCKED`, so the one-week shadow-mode start is not scheduled and the switch stays off. Rerun the benchmark with the incumbent and an API provider (measured cost) and no errored PRs; on `PASS`, enable `shadowReview` on the line for one week before replacing the incumbent. Shadow mode is an operational step in the factory line, not part of this repository's runtime.
