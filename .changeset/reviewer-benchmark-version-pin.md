---
"@agentskit/code-review": minor
---

feat: pin the measured version. The reviewer benchmark report now records the measured `candidateVersion` and the labelled dataset's `datasetSha256`, and `scripts/check-version-pin.mjs` (with `checkVersionPin()`) rejects a pin that is `latest`, a tag or a range, that differs from the measured version, that comes from a report that is not `PASS`, or that was measured on another dataset (RF-09).
