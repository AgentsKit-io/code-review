# Reviewer benchmark: BLOCKED

Requirement `mvp:RF-02`: real bugs found and false positives of both reviewers, per PR and in total.

- incumbent errored on 38 PR(s); rerun before comparing
- code-review errored on 11 PR(s); rerun before comparing

## Counting rule

Both reviewers run over the same labelled PRs (`quality/benchmark/prs.json`) and are scored by the same function (`scorePr` in `src/reviewer-benchmark.ts`):

- A **real bug** is a known bug (a defect later fixed by a fix PR) matched by at least one finding on the same file within the line tolerance (default 3 lines); each known bug counts once.
- A **false positive** is any finding that matches no known bug, including every finding on a clean PR.
- A PR where the reviewer errored shows `error` and is not counted; any error makes the decision `BLOCKED`.

## Totals

| Reviewer | Bugs found | False positives | Cost (US$) | Mean latency (ms) | Errored PRs |
| --- | --- | --- | --- | --- | --- |
| incumbent | 0/32 | 0 | 0.00 | 4 | 38 |
| code-review | 8/32 | 118 | 0.00 | 235158 | 11 |

## Per PR

| PR | incumbent bugs | incumbent false positives | code-review bugs | code-review false positives |
| --- | --- | --- | --- | --- |
| AgentsKit-io/code-review#178 | error | - | 2/2 | 9 |
| AgentsKit-io/code-review#62 | error | - | error | - |
| AgentsKit-io/code-review#40 | error | - | error | - |
| AgentsKit-io/code-review#67 | error | - | error | - |
| AgentsKit-io/code-review#130 | error | - | error | - |
| AgentsKit-io/code-review#80 | error | - | 1/1 | 1 |
| AgentsKit-io/code-review#180 | error | - | error | - |
| AgentsKit-io/code-review#204 | error | - | 0/1 | 14 |
| AgentsKit-io/code-review#186 | error | - | error | - |
| AgentsKit-io/code-review#73 | error | - | error | - |
| AgentsKit-io/harness#144 | error | - | 1/1 | 2 |
| AgentsKit-io/harness#142 | error | - | 1/2 | 0 |
| AgentsKit-io/harness#133 | error | - | 0/1 | 3 |
| AgentsKit-io/harness#103 | error | - | 0/1 | 8 |
| AgentsKit-io/harness#101 | error | - | error | - |
| AgentsKit-io/harness#198 | error | - | 1/2 | 9 |
| AgentsKit-io/harness#199 | error | - | 0/1 | 2 |
| AgentsKit-io/harness#201 | error | - | 1/2 | 2 |
| AgentsKit-io/harness#98 | error | - | 1/1 | 12 |
| AgentsKit-io/harness#111 | error | - | error | - |
| AgentsKit-io/harness#39 | error | - | error | - |
| AgentsKit-io/harness#184 | error | - | 0/1 | 3 |
| AgentsKit-io/code-review#27 | error | - | 0/0 | 5 |
| AgentsKit-io/code-review#166 | error | - | 0/0 | 3 |
| AgentsKit-io/code-review#280 | error | - | 0/0 | 3 |
| AgentsKit-io/code-review#319 | error | - | 0/0 | 0 |
| AgentsKit-io/harness#28 | error | - | 0/0 | 6 |
| AgentsKit-io/harness#29 | error | - | 0/0 | 7 |
| AgentsKit-io/harness#42 | error | - | 0/0 | 3 |
| AgentsKit-io/harness#44 | error | - | 0/0 | 3 |
| AgentsKit-io/harness#97 | error | - | 0/0 | 4 |
| AgentsKit-io/harness#107 | error | - | error | - |
| AgentsKit-io/doc-bridge#76 | error | - | 0/0 | 2 |
| AgentsKit-io/doc-bridge#197 | error | - | 0/0 | 2 |
| AgentsKit-io/doc-bridge#207 | error | - | 0/0 | 5 |
| AgentsKit-io/doc-bridge#317 | error | - | 0/0 | 2 |
| AgentsKit-io/doc-bridge#369 | error | - | 0/0 | 6 |
| AgentsKit-io/doc-bridge#393 | error | - | 0/0 | 2 |
| **Total** | **0/32** | **0** | **8/32** | **118** |

## Falsos positivos por categoria

Findings that matched no known bug, grouped by title (the rule that produced them). The finding list of every PR, with its verdict and the known bug it matched, is in `quality/benchmark/report.json` (`perPr[].findings`); a failed PR keeps its cause in `perPr[].errorDetail` (exit code, stage, last stderr lines, secrets redacted).

The measurement committed here predates this recording, so it has no per-finding data: rerun the benchmark (see Reproduce) to fill this section; the generator renders one table per reviewer plus a "Failed PRs" table.

## Reproduce

```bash
npm ci && npm run build
export GITHUB_TOKEN=... AGENTSKIT_SHADOW_PROVIDER=anthropic AGENTSKIT_SHADOW_USD_PER_MTOK=<price>
node scripts/run-reviewer-benchmark.mjs --incumbent-cmd <line reviewer executable> \
  --candidate-cmd ./scripts/shadow-review.mjs --concurrency 6 \
  --output quality/benchmark/report.json --markdown docs/reviewer-benchmark-report.md
```

The incumbent command is run as `<executable> <owner/repo> <number>` and prints `{"findings":[{"file","line","title"}],"costUsd":0}`; see `docs/reviewer-benchmark.md`.
