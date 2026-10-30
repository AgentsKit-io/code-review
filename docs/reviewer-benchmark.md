# Reviewer benchmark

Gate for making Code Review the factory's review stage. The labelled PR set lives in `quality/benchmark/prs.json`; the scoring is in `src/reviewer-benchmark.ts`; the runner is `scripts/run-reviewer-benchmark.mjs`. Run it on every release.

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

## After a pass

Run Code Review in shadow mode on the line for one week (it comments and does not decide) before replacing the incumbent. Shadow mode is an operational step in the factory line, not part of this repository's runtime.
