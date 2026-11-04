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

`quality/benchmark/prs.json`: 38 merged AgentsKit-io PRs, 22 `buggy` and 16 `clean`, from the repositories where both reviewers run (code-review, harness, doc-bridge). Every PR pins `commit`, the 40-hex head commit that both reviewers are given. A `buggy` PR is one whose merged code was later corrected by a fix PR: each bug lists `file`, `line` (in the reviewed PR's version of the file, from `git blame` of the lines the fix replaced), `lineTolerance`, a `note`, and `fix` (the fix PR number and commit that proves it was real). A `clean` PR is a feature PR that no later fix PR in the same repository touched (never the origin of any blamed line of a `fix:` commit). The set was mined from `fix:` commits in code-review, harness and doc-bridge; PRs are added by annotating real PRs, never by invention. The report is `BLOCKED` until the set has 30 PRs with both labels.

## Run

```bash
npm run build
node scripts/run-reviewer-benchmark.mjs --incumbent-cmd ./path/to/line-reviewer \
  --provider claude-cli --usd-per-mtok 5 --output report.json --markdown report.md
```

An external reviewer command is run as `<executable> <owner/repo> <number> <commit>` (no shell; `<commit>` is the pinned head of the set) and prints `{"findings":[{"file","line","title"}],"costUsd":0}`. Without `--candidate-cmd` the built-in CLI reviews each PR with `--pr` (needs `GITHUB_TOKEN`; provider keys come from the environment, never from arguments). Cost for the built-in reviewer is `tokensUsed` times `--usd-per-mtok`.

## Same PRs, same commit, which set and version (`mvp:RF-01`)

The runner gives the incumbent and code-review exactly the PRs of the set, one after the other, and reads each PR's head from GitHub (`GITHUB_TOKEN`; `AGENTSKIT_BENCHMARK_GITHUB_API` overrides the API address) before and after the two runs. A head that is not the pinned `commit` records an error for both reviewers on that PR (the PR is not reviewed, or its result is discarded), which makes the decision `BLOCKED`, so neither reviewer is ever scored on a different commit than the other. The report (`set` and `run` in the JSON, section "Set and version" in the Markdown) states the set path, its format version, its sha256 digest, the PR counts and repositories, the commit given for every PR, and the code-review package version and git commit that ran. The digest changes whenever a PR, label, bug or pinned commit of the set changes.

The committed `report.json` predates this section: it was measured before the commits were pinned and lists a PR that has since been corrected in the set (`code-review#40` is an issue; the PR is `#51`). The next run replaces it.

### The incumbent command (`mvp:RF-03`)

`scripts/incumbent-review.mjs <owner/repo> <number> [<commit>]` (also the `agentskit-incumbent-review` bin) is the incumbent as an executable: the line's single-pass review (no lenses). Given the pinned `<commit>` (40-hex, which the runner always passes) it reads the PR head first and exits non-zero when the head is another commit, so it never reviews a commit the benchmark does not score. It fetches the PR diff (`GITHUB_TOKEN`; `GITHUB_API_URL` for another API host), sends it to a headless model CLI on stdin and prints one line, `{"findings":[{"file","line","title"}],"costUsd":0}`. A failure (diff not fetched or too large, model exit, unparseable answer) exits non-zero, so the benchmark records that PR as an error and never scores it as clean. Environment only: `AGENTSKIT_INCUMBENT_CMD` (default `claude`), `AGENTSKIT_INCUMBENT_ARGS` (JSON array, default `["-p","--output-format","json"]`), `AGENTSKIT_INCUMBENT_USD_PER_MTOK` (cost is the tokens of the CLI's `usage` times this price), `AGENTSKIT_INCUMBENT_MAX_DIFF_CHARS`.

```bash
export GITHUB_TOKEN=... AGENTSKIT_INCUMBENT_USD_PER_MTOK=5
node scripts/run-reviewer-benchmark.mjs --incumbent-cmd ./scripts/incumbent-review.mjs --candidate-cmd ./scripts/shadow-review.mjs
```

The report records `candidateVersion` (this package's version, or `--candidate-version` when `--candidate-cmd` runs another build) and `datasetSha256` (the labelled set that was run).

## Entry criterion

`PASS` needs: at least as many real bugs found as the incumbent, strictly fewer false positives (any finding matching no known bug, and every finding on a clean PR), and cost at most 1.2x the incumbent. Any errored PR (exit 2 for a deadline or provider failure) makes the report `BLOCKED`. With `--stage-timeout-ms <n>` (the time the line gives its review stage) the candidate's p90 latency, shown in the report, must also fit in it or the report is `FAIL` (RF-05: every PR completes, with the configuration that goes to the line, within the stage time). The exit code is 2 unless `PASS`.

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

## Pinning the measured version

The line installs Code Review at the exact version that was measured, never `@latest`, a tag or a range. Before it pins or changes that version it runs:

```bash
node node_modules/@agentskit/code-review/scripts/check-version-pin.mjs --pin 0.33.0 \
  [--report quality/benchmark/report.json] [--dataset quality/benchmark/prs.json]
```

It exits 0 only when the pin is an exact version, the report's decision is `PASS`, the report's `candidateVersion` is that version and its `datasetSha256` matches the current labelled set; otherwise it exits 2 and lists the reasons. A new version, or a changed `prs.json`, therefore needs a new benchmark run against the incumbent before the line may use it. The shipped report is `BLOCKED`, so no version can be pinned yet; the one-week shadow run (after a `PASS`) must use the same pinned version.

## After a pass

Not reached: the decision is `BLOCKED`, so the one-week shadow-mode start is not scheduled and the switch stays off. Rerun the benchmark with the incumbent and an API provider (measured cost) and no errored PRs; on `PASS`, enable `shadowReview` on the line for one week before replacing the incumbent. Shadow mode is an operational step in the factory line, not part of this repository's runtime.

## Deciding on the line (`mvp:RF-10`)

`scripts/line-review.mjs` (also the `agentskit-line-review` bin) is the command the line's review stage calls once Code Review replaces the incumbent. It runs like the shadow command (PR checkout as working directory, or `<owner/repo> <number>`), but it **decides**. The last line of stdout is `{"decision","decidedBy","reason","comment","costUsd","findings","at","benchmarkDecision"}` and the exit code follows the decision:

| decision | decidedBy | exit | when |
| --- | --- | --- | --- |
| `approve` | `code-review` | 0 | complete review, no blocking finding |
| `request_changes` | `code-review` | 1 | complete review with a blocking finding (`REQUEST CHANGES` or `blocking`) |
| `block` | `none` | 2 | failed or incomplete review with `AGENTSKIT_LINE_ON_FAILURE=block`; also usage errors |
| `fallback` | `incumbent` | 3 | the benchmark report is not `PASS`, or a failed or incomplete review (default policy) |

It fails closed. It reads the `decision` of the benchmark report shipped with the installed version (`quality/benchmark/report.json`, or `AGENTSKIT_LINE_BENCHMARK_REPORT`), and anything other than `PASS` returns `fallback` without calling a provider, so the switch stays off until the measured version passes. A review is complete only when it is not `incomplete`, has no unreviewed file and no missing required lens, did not pass its deadline, and every lens execution succeeded. Anything else (including a non-zero CLI exit, a missing result, or a change with no added or modified file) never approves. Configuration is environment only: `AGENTSKIT_LINE_PROVIDER`, `AGENTSKIT_LINE_MODEL`, `AGENTSKIT_LINE_MODE`, `AGENTSKIT_LINE_CONFIG`, `AGENTSKIT_LINE_USD_PER_MTOK`, `AGENTSKIT_LINE_BASE`, `AGENTSKIT_LINE_ON_FAILURE` (`incumbent` by default, or `block`).

`AGENTSKIT_LINE_RECORD=<file.jsonl>` appends every decision (`at`, PR, `decision`, `decidedBy`, `reason`, `benchmarkDecision`, `costUsd`, finding count) to that file, so its first `decidedBy: "code-review"` line is the record of the first real PR the line decided with Code Review.

First real PR decided by Code Review: **none yet**. The shipped report is `BLOCKED`, so the command falls back to the incumbent. Record the PR here once the line runs with a `PASS` version.
