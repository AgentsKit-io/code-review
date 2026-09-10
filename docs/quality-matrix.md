# Review quality matrix

The versioned baseline evidence classes and v0.8.0 reproduction command are defined in [the baseline protocol](baseline-protocol.md).

The quality matrix is the release gate for continuous improvement of the review process. It measures the result of a real review run or campaign; it does not turn a benchmark pass, a file count, or a rendered report into evidence of semantic correctness.

## Decision rule

`evaluateQuality()` returns `PASS` only when every area has a measured score of at least 3/4 and every absolute gate passes. A missing metric is `not-measured` and blocks the run. The minimum score is intentionally fixed at 3: no area may be below 3. `evaluateCampaignQuality()` produces the same matrix for every campaign outcome, bounds each area by its pull-request results, and blocks when any discovered pull request lacks a terminal outcome or completed quality matrix.

The absolute gates require complete file/lens coverage, no secret leak, unsafe action, fail-open event, stale artifact, incomplete acceptance, invalid inline comment, or silent failure. Campaign matrices additionally require terminal coverage and one quality matrix for every completed pull request. `agentskit-review-campaign` writes this matrix as `quality-matrix.json` beside the campaign state (or to `--quality-output`), keeping the strict campaign execution report contract backward-compatible.

## Reproducible evaluation

Build the package, then evaluate a JSON artifact produced by the Orca run:

```sh
npm run quality:matrix -- --input ./artifacts/quality-input.json \
  --baseline ./artifacts/quality-baseline.json \
  --output ./artifacts/quality-report.json \
  --max-score-drop 1

# From an installed package (for Orca and other external runners):
npx --yes --package=@agentskit/code-review@latest agentskit-quality \
  --input ./artifacts/quality-input.json \
  --baseline ./artifacts/quality-baseline.json \
  --output ./artifacts/quality-report.json
```

The command exits `0` only for `PASS` and exits `2` for `BLOCKED`. The report includes the run ID, library version, source revision, every area score, gate details, and baseline regressions. `--max-score-drop` controls the material-regression threshold and defaults to one score point. The input must be tied to the reviewed PR SHA and exact library/configuration versions; manually estimated values are not valid evidence.

The matrix separates process evidence from review correctness. Every input declares `evidence.kind` as `synthetic`, `real-run`, or `real-campaign`; synthetic corpus metrics cannot be presented as operational evidence. `expected`, `detectedExpected`, `falsePositives`, `severityMatches`, and `inlineValid` come from the versioned labelled corpus executed with the same live provider and policy. A clean target PR is still useful operational evidence, but it cannot substitute for known-positive detection cases.

The CLI validates the complete `QualityInput` shape before scoring. A malformed or incompatible runner artifact produces a structured `BLOCKED` report with `inputError` and a failed `valid-quality-input` gate, and exits with code `2`; it never becomes an uncaught runtime exception or a partial pass.

## Input contract

The JSON shape is the `QualityInput` type exported from the package root. It contains coverage, findings, comments, security, reliability, performance, tokens, batches, memory, configuration, and integration groups. A complete example is kept in `test/quality-matrix.test.mjs`.

Memory and feedback are measured only when enabled. If memory is enabled, persistence, loading, malformed-input rejection, feedback recording, and approval gating all require evidence. A live A/B canary also runs the same labelled case with and without one explicitly approved memory rule. Memory passes only when the rule creates a detection lift without false positives or duplicates and keeps tokens per provider call within 10% of the memory-off arm. This normalization accounts for the required skeptic call that only a detected finding triggers. Operational state, review cache, feedback, and permanent knowledge have separate schemas and lifecycles. The knowledge store is allow-list shaped: only bounded approved rules can enter it, so source, prompts, secrets, and raw provider transcripts are not retained as knowledge.

Review-unit reuse is recorded in the optional `cache` input group: `hits`, `misses`, miss reasons, and `savedTokens`. These are evidence fields, not a license to accept stale work. A cache hit must still pass the current artifact validator, and only the complete identity fingerprint can select a record.

Budget evidence is retained in `tokens.accounting` when the provider reports it. The fields distinguish input, cached input, output, reasoning, memory, retry, and total token usage; missing provider dimensions are omitted rather than guessed. When complete accounting is available, every token class contributes to token efficiency. Retries, wasted provider calls, provider-call baselines, and complete wall-clock baselines contribute to batch and speed scores, so a fast but wasteful run cannot pass as efficient. A quality run must also retain the resolved campaign, pull-request, context-pack, analysis, and verification limits so a passing result cannot hide a child scope that consumed a parent reserve.

## Baselines and regressions

Use the same labelled corpus and comparable PR shape when creating a baseline. Token efficiency is measured per changed line so clean reviews remain measurable. `compareQuality()` reports score regressions, material regressions, and improvements by area. `evaluateQualityAgainstBaseline()` adds a release gate for configured material regressions; by default a one-point jitter is tolerated because it can still leave the area at the required 3/4 floor. A regression to 2 or a newly missing area blocks publication even if the aggregate result looks better. Use `--max-score-drop 1` for a stricter baseline-specific policy.

The deterministic `npm run benchmark:cycle` remains a process-safety benchmark. It is complementary to this matrix and cannot provide the semantic ground truth needed for detection or precision.

## Versioned semantic evals

`quality/evals/default.json` is the small labelled corpus used by the credential-free eval test. It contains both known-positive defects and clean cases, and is intentionally separate from local real-provider artifacts. Run the packaged checks with:

```sh
npm run build
node --test --test-concurrency=1 test/quality-evals.test.mjs
```

The fixture proves the evaluator wiring, coverage accounting, expected detection, precision, severity, actionability, and fail-closed coverage gates. It does not claim that a fixture is equivalent to a live model. A production quality report must rerun the same corpus with the configured provider and retain its SHA, package, configuration, prompt, and model evidence outside the repository.

Skeptical verification is deterministic and adaptive: candidates are sent in bounded batches; blocker/high findings and low-confidence medium findings receive a second vote; a third vote is requested only after disagreement. Missing, malformed, or failed batch evidence removes the affected findings and marks the review incomplete, so it cannot approve. `ReviewEvidence` records candidate, request, vote, failure, and unverified counts for the quality matrix.
