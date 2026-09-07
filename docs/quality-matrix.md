# Review quality matrix

The quality matrix is the release gate for continuous improvement of the review process. It measures the result of a real review run; it does not turn a benchmark pass, a file count, or a rendered report into evidence of semantic correctness.

## Decision rule

`evaluateQuality()` returns `PASS` only when every area has a measured score of at least 3/4 and every absolute gate passes. A missing metric is `not-measured` and blocks the run. The minimum score is intentionally fixed at 3: no area may be below 3.

The absolute gates require complete file/lens coverage, no secret leak, unsafe action, fail-open event, stale artifact, incomplete acceptance, invalid inline comment, or silent failure.

## Reproducible evaluation

Build the package, then evaluate a JSON artifact produced by the Orca run:

```sh
npm run quality:matrix -- --input ./artifacts/quality-input.json \
  --baseline ./artifacts/quality-baseline.json \
  --output ./artifacts/quality-report.json
```

The command exits `0` only for `PASS` and exits `2` for `BLOCKED`. The report includes the run ID, library version, source revision, every area score, gate details, and baseline regressions. The input must be tied to the reviewed PR SHA and exact library/configuration versions; manually estimated values are not valid evidence.

The matrix separates process evidence from review correctness. `expected`, `detectedExpected`, `falsePositives`, `severityMatches`, and `inlineValid` must come from a labelled evaluation set or human-confirmed ground truth. Without ground truth, the corresponding area is blocked rather than treated as successful.

## Input contract

The JSON shape is the `QualityInput` type exported from the package root. It contains coverage, findings, comments, security, reliability, performance, tokens, batches, memory, configuration, and integration groups. A complete example is kept in `test/quality-matrix.test.mjs`.

Memory and feedback are measured only when enabled. If memory is enabled, persistence, loading, malformed-input rejection, feedback recording, and rule approval all require evidence. The matrix does not claim automatic learning until the feedback path has actually recorded and approved a rule.

## Baselines and regressions

Use the same labelled corpus and comparable PR shape when creating a baseline. `compareQuality()` reports score regressions and improvements by area; it does not override an absolute gate. A regression to 2 or a newly missing area blocks publication even if the aggregate result looks better.

The deterministic `npm run benchmark:cycle` remains a process-safety benchmark. It is complementary to this matrix and cannot provide the semantic ground truth needed for detection or precision.
