# Reviewer benchmark

Gate for making Code Review the factory's review stage. The labelled PR set lives in `quality/benchmark/prs.json`; the scoring is in `src/reviewer-benchmark.ts`; the runner is `scripts/run-reviewer-benchmark.mjs`. Run it on every release.

## Status

Not evaluated. The labelled set is empty and neither reviewer has been run, so the entry criterion has not been applied and **the switch of the factory's review stage to Code Review is not going ahead**. The comparison runs on the line itself, in a follow-up ticket, through the factory's shadow mode.

## Dataset

At least 30 merged PRs from AgentsKit-io and NoxCodeSolutions. `buggy` PRs list the known bugs (review findings that became a fix: `file`, `line`, optional `lineTolerance` and `titleIncludes`, and a `note`); `clean` PRs merged with no real defect. The report is `BLOCKED` until the set has 30 PRs with both labels. The shipped file starts empty: PRs are added by annotating real reviewed PRs, never by invention.

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

The incumbent is not a standalone executable: it is the `review` stage of the factory line (`reviewPrompt` in `packages/factory-line/src/prompts.ts`, private repository). The comparison therefore runs on the line through its shadow mode (`shadow-review.ts`, enabled per repository by `shadowReview` in `line.json`), which comments and does not decide.

Shadow mode calls the Code Review command as `<exe>` with the PR's checkout as the working directory, and reads the **last line of stdout** as JSON: `{"comment":"<review markdown>","costUsd":0,...}`. The command must print that line last, keep keys and tokens out of it, and exit 0. Any wrapper that reviews the checked-out PR with `agentskit-review` and prints that line satisfies the contract; this repository does not yet ship the wrapper.

## After a pass

Run Code Review in shadow mode on the line for one week before replacing the incumbent. Shadow mode is an operational step in the factory line, not part of this repository's runtime.
