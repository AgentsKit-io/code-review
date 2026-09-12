# v0.8.0 baseline protocol

Issue #138 of PRD #137 establishes the reproducible comparison point for later engine work. It defines evidence and measurement; it does not claim semantic quality from fixtures.

## Release 0.31 pre-change baseline (issue #250)

Before any 0.31 change lands, issue #250 expands the labelled corpus so every later 0.31
issue (#251, #252, ...) has a fixed comparison point instead of a moving `main`.

- **[`quality/evals/default.json`](../quality/evals/default.json)** grew from 6 to 20
  cases: 8 plain positive (detectable real bugs), 4 protected-subject positive
  (`concurrency`, `behavioral-change`, `unused-parameter`, `memory-safety` — the subjects
  #252's asymmetric-loss skeptic vetoes before assessing correctness), and 8 clean (no
  findings). `test/quality-evals.test.mjs` exercises every case through the fixture-backed
  agent and asserts the corpus balance.
- The v0.30.17 fixture baseline itself is captured the same way as every other baseline in
  this protocol — external to the repository, never committed (see below). It is the
  reference point every later 0.31 change (skeptic posture, per-language rules, semantic
  grouping) is compared against with `npm run quality:matrix -- --baseline <path>`.

Reproduce the 0.31 pre-change snapshot:

```sh
npm ci
npm run benchmark:baseline -- --library-version 0.30.17 --output /absolute/path/0.30.17.json
```

The resulting `baselineId` and `policyFingerprint`/`promptFingerprint` are the fixed
reference for 0.31. A later issue (e.g. #251's `analysis`-first schema change, #252's
verification-posture rewrite) is expected to change those fingerprints in a *new*,
separately captured baseline — this snapshot stays the fixed point from before those
changes.

## Evidence classes

- **Synthetic process evidence** proves deterministic fail-closed behavior without credentials.
- **Real pull-request evidence** measures one SHA-bound review, including semantic quality, complete tokens, memory behavior, and wall-clock components.
- **Real campaign evidence** measures discovery, terminal outcomes, retries, cache reuse, publication, merge, total tokens, and complete wall-clock time.

Synthetic and real evidence are distinct in schema version 2. Missing provider token or duration dimensions are `null` (unmeasured), never zero.

## Reproduce the v0.8.0 fixture baseline

```sh
npm ci
npm run benchmark:baseline -- --library-version 0.8.0
```

The stable baseline identity includes library and source version, policy fingerprint, prompt fingerprint, and model identity. The command wraps the existing credential-free cycle benchmark. Use `--output /absolute/path/baseline.json` only for a path outside the repository; `validateStudyOutputPath` (`src/quality-baseline.ts`) refuses an in-repo path by design, for the v0.30.17 snapshot above as much as for any other baseline capture.

Real canary and campaign matrices are local study artifacts. Store them outside the repository and do not commit or publish them with the package.

## Comparison targets

Using the same corpus and real canary, later releases must preserve expected detections and precision while delivering at least 75% lower total token usage, three times fewer model calls, and three times lower small-PR wall-clock time than v0.8.0. The quality evaluator and regression policy are delivered in later PRD phases.
