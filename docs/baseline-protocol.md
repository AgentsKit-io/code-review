# v0.8.0 baseline protocol

Issue #138 of PRD #137 establishes the reproducible comparison point for later engine work. It defines evidence and measurement; it does not claim semantic quality from fixtures.

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

The stable baseline identity includes library and source version, policy fingerprint, prompt fingerprint, and model identity. The command wraps the existing credential-free cycle benchmark. Use `--output /absolute/path/baseline.json` only for a path outside the repository.

Real canary and campaign matrices are local study artifacts. Store them outside the repository and do not commit or publish them with the package.

## Comparison targets

Using the same corpus and real canary, later releases must preserve expected detections and precision while delivering at least 75% lower total token usage, three times fewer model calls, and three times lower small-PR wall-clock time than v0.8.0. The quality evaluator and regression policy are delivered in later PRD phases.
