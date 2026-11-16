# Reviewer benchmark: FAIL

Requirement `mvp:RF-02`: real bugs found and false positives of both reviewers, per PR and in total.

- false positives 0 are not fewer than incumbent 0

Candidate version: 0.32.5; dataset sha256: 54b8dcfae1f257fc512d9e69c115582d2d5681adb10b836366525dcb4950af68

## Set and version (`mvp:RF-01`)

Both reviewers were given exactly these PRs, each at the pinned head commit below (the runner stops on a PR whose head moved).

- Set: `quality/benchmark/prs.json`, format version 1, sha256 `0af089b36b75271f0028ada15940f8a717f7d50e462a4dfd99e9f65b8c10b68f`
- 38 merged PRs: 22 `buggy` (each bug cites the fix that proves it) and 16 `clean`, from AgentsKit-io/code-review, AgentsKit-io/doc-bridge, AgentsKit-io/harness
- code-review: `0.32.5` at commit `8589e2ea9e222d37fe8c1886e10fe0c3e4e1f142`

| PR | Label | Commit given to both reviewers |
| --- | --- | --- |
| AgentsKit-io/code-review#178 | buggy | `fbe240e9e03b471437d86f6e993287912dac96a0` |
| AgentsKit-io/code-review#62 | buggy | `380f94707384566bea9900c717621035030ad35f` |
| AgentsKit-io/code-review#51 | buggy | `b062b50069424693da9e1191793c69a98890caab` |
| AgentsKit-io/code-review#67 | buggy | `cbb0e4d056e8b727a94c4db9eb11e5f38c5cb1ad` |
| AgentsKit-io/code-review#130 | buggy | `1bc8f17bb461cba6ef0d4875776f88118f26daf7` |
| AgentsKit-io/code-review#80 | buggy | `c84ae8c136018691b3eb889f89eecfdd1942726f` |
| AgentsKit-io/code-review#180 | buggy | `8777f2b5d79e2443b41f1987644ad191c4797df4` |
| AgentsKit-io/code-review#204 | buggy | `35f01c0d43e8bfb9596dcfebc481669877b51064` |
| AgentsKit-io/code-review#186 | buggy | `527325c6a88e2bfaf7b800b29650a0c728d31b4d` |
| AgentsKit-io/code-review#73 | buggy | `414f24075f9334bd4f454279edf7801e4290530c` |
| AgentsKit-io/harness#144 | buggy | `b871ec60b8b9a8b77bc0d68f088e48883316b88f` |
| AgentsKit-io/harness#142 | buggy | `320d500b3898e29de48536d2110dd383eb255d3d` |
| AgentsKit-io/harness#133 | buggy | `c35caf8cd7de413a2b2b9a01523b8d01e3d2ef8f` |
| AgentsKit-io/harness#103 | buggy | `d76d2de59d7c74323fefd642dffcd9a748ca968a` |
| AgentsKit-io/harness#101 | buggy | `48acd101e3749dcda1ba77b396be6cceee9548d3` |
| AgentsKit-io/harness#198 | buggy | `d547f7714fe16c1e1eaac3065d22d9e40094c5b6` |
| AgentsKit-io/harness#199 | buggy | `5b8a2b38e5d9557aeae1393c55fd411699668f84` |
| AgentsKit-io/harness#201 | buggy | `abee6f9e8588feec3b1c8e0e1a7198e372baeaad` |
| AgentsKit-io/harness#98 | buggy | `cc2ce40eb2e5f7157118e5da107b650a264f5618` |
| AgentsKit-io/harness#111 | buggy | `615bf4a098df96ddd835cbf058915d1e8786e95c` |
| AgentsKit-io/harness#39 | buggy | `41b12845f8d51148ba2037cb18db55281db2a5df` |
| AgentsKit-io/harness#184 | buggy | `496570e1a598972bcb7bb16611d23375c2f2b696` |
| AgentsKit-io/code-review#27 | clean | `f9bee0d37afeecfc8b47d2490c5333623f7b01a6` |
| AgentsKit-io/code-review#166 | clean | `b7429a0dc9c87726cec2ab3a66492e70d1df42a6` |
| AgentsKit-io/code-review#280 | clean | `cdda0d6eef5797a0414a06a523503626d7441643` |
| AgentsKit-io/code-review#319 | clean | `1b2b78458bc6e4d1b84ae458e787a8dd6c7c152b` |
| AgentsKit-io/harness#28 | clean | `2214c34845d53d6305ca0744f8df07a6a39c57af` |
| AgentsKit-io/harness#29 | clean | `dad0818e5ef36be7427bdbf8f8e1522c1b2e1ec5` |
| AgentsKit-io/harness#42 | clean | `541cb89d5e6625f07c28c6d247238d79654fc0dd` |
| AgentsKit-io/harness#44 | clean | `777b6c5fcbf4f6d34a518affbe9ec55bb9584692` |
| AgentsKit-io/harness#97 | clean | `9d293fa9fec6f0a9f8d682148d7d0fbb314d3ca0` |
| AgentsKit-io/harness#107 | clean | `5905653b215b63e0f57f0c102d752d6c1d7bc42c` |
| AgentsKit-io/doc-bridge#76 | clean | `c93053c4418680d6a30a8f8d930b08d63b8b7a70` |
| AgentsKit-io/doc-bridge#197 | clean | `7de3f4c99654d9e13bd202b5b5c2938e233b2faf` |
| AgentsKit-io/doc-bridge#207 | clean | `cd54d5acef2b6cacb8999d9db946123a37b35035` |
| AgentsKit-io/doc-bridge#317 | clean | `e3d310bc1a1b5bdb5af61a6abcd46e7f0033a8c3` |
| AgentsKit-io/doc-bridge#369 | clean | `4105af5e283e6c35e1f23f71e2afffe2f88a1230` |
| AgentsKit-io/doc-bridge#393 | clean | `bfd70eefb2b5d77049ed866e0cbf09be67411602` |

## Counting rule

Both reviewers run over the same labelled PRs (`quality/benchmark/prs.json`) and are scored by the same function (`scorePr` in `src/reviewer-benchmark.ts`):

- A **real bug** is a known bug (a defect later fixed by a fix PR) matched by at least one finding on the same file within the line tolerance (default 3 lines); each known bug counts once.
- A **false positive** is any finding that matches no known bug, including every finding on a clean PR.
- A PR where the reviewer errored shows `error` and is not counted; any error makes the decision `BLOCKED`.

## Totals

| Reviewer | Bugs found | False positives | Input tokens | Output tokens | Cost (US$) | Mean latency (ms) | p90 latency (ms) | Errored PRs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| incumbent | 0/32 | 0 | 38000 | 19000 | 0.40 | 2 | 2 | 0 |
| code-review | 0/32 | 0 | 38000 | 19000 | 0.40 | 2 | 2 | 0 |

## Per PR

| PR | incumbent bugs | incumbent false positives | code-review bugs | code-review false positives |
| --- | --- | --- | --- | --- |
| AgentsKit-io/code-review#178 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/code-review#62 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/code-review#51 | 0/3 | 0 | 0/3 | 0 |
| AgentsKit-io/code-review#67 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/code-review#130 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/code-review#80 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/code-review#180 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/code-review#204 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/code-review#186 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/code-review#73 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#144 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#142 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/harness#133 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#103 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#101 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/harness#198 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/harness#199 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#201 | 0/2 | 0 | 0/2 | 0 |
| AgentsKit-io/harness#98 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#111 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#39 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/harness#184 | 0/1 | 0 | 0/1 | 0 |
| AgentsKit-io/code-review#27 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/code-review#166 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/code-review#280 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/code-review#319 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/harness#28 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/harness#29 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/harness#42 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/harness#44 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/harness#97 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/harness#107 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/doc-bridge#76 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/doc-bridge#197 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/doc-bridge#207 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/doc-bridge#317 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/doc-bridge#369 | 0/0 | 0 | 0/0 | 0 |
| AgentsKit-io/doc-bridge#393 | 0/0 | 0 | 0/0 | 0 |
| **Total** | **0/32** | **0** | **0/32** | **0** |

## Falsos positivos por categoria

Findings that matched no known bug, grouped by title (the rule that produced them). The finding list of every PR, with its verdict and the known bug it matched, is in `quality/benchmark/report.json` (`perPr[].findings`); a failed PR keeps its cause in `perPr[].errorDetail`.

### incumbent

No false positives.

### code-review

No false positives.

## Failed PRs

No PR errored.

## Cost per PR (`mvp:RF-04`)

Cost is computed from the input and output tokens each reviewer reported, with the same per-model price table for both (`quality/benchmark/prices.json`, rates of 2026-11-02). A completed PR without tokens or without a priced model makes the report `BLOCKED`; it is never shown as zero.

| PR | incumbent in/out tokens | incumbent US$ | code-review in/out tokens | code-review US$ |
| --- | --- | --- | --- | --- |
| AgentsKit-io/code-review#178 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#62 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#51 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#67 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#130 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#80 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#180 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#204 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#186 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#73 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#144 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#142 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#133 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#103 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#101 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#198 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#199 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#201 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#98 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#111 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#39 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#184 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#27 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#166 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#280 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/code-review#319 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#28 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#29 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#42 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#44 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#97 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/harness#107 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/doc-bridge#76 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/doc-bridge#197 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/doc-bridge#207 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/doc-bridge#317 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/doc-bridge#369 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| AgentsKit-io/doc-bridge#393 | 1000/500 | 0.0105 | 1000/500 | 0.0105 |
| **Total** | **38000/19000** | **0.3990** | **38000/19000** | **0.3990** |

## Reproduce

```bash
npm ci && npm run build
export GITHUB_TOKEN=... AGENTSKIT_SHADOW_PROVIDER=anthropic AGENTSKIT_SHADOW_MODEL=<model in prices.json>
node scripts/run-reviewer-benchmark.mjs --incumbent-cmd <line reviewer executable> \
  --candidate-cmd ./scripts/shadow-review.mjs --concurrency 6 \
  --output quality/benchmark/report.json --markdown docs/reviewer-benchmark-report.md
```

The incumbent command is run as `<executable> <owner/repo> <number> <commit>` (the pinned commit of the set) and prints `{"findings":[{"file","line","title"}],"model","inputTokens","outputTokens"}`; see `docs/reviewer-benchmark.md`.
