# Shadow week protocol

After the [reviewer benchmark](./reviewer-benchmark.md) returns `PASS`, Code Review runs in shadow mode (it comments, it does not decide) next to the incumbent line reviewer for 7 consecutive days on the 2 or 3 repositories of the line with the most PRs. This page is the protocol and the offline report generator. The real week's data and report live in the line's private repository, not here; the example in `quality/shadow-week/example.json` is synthetic.

## Run

1. Enable shadow mode (`scripts/shadow-review.mjs`, see the benchmark page) on the chosen repositories. Both reviewers see every PR; neither blocks.
2. At the end of the week, for each reviewed PR classify each finding of each reviewer: `fix` (it became a correction in the PR or a later fix) or `false-alarm`. Record the tokens each reviewer used.
3. Write one JSON file and render the report:

```bash
npm run build
node scripts/render-shadow-week-report.mjs shadow-week.json --output report.json --markdown report.md
```

## Input

```json
{ "version": 1, "usdPerMtok": 5, "prs": [{ "id": "example-org/alpha#101", "repository": "example-org/alpha", "number": 101, "date": "2030-01-01",
  "reviewers": { "incumbent": { "findings": [{ "title": "...", "verdict": "fix" }], "tokens": 10000 },
                 "code-review": { "findings": [], "tokens": 11000 } } }] }
```

One `usdPerMtok` applies to both reviewers: cost is counted from tokens with the same price table. Every finding must be classified.

## Criteria

Same three as the benchmark, on the week's totals: fixes at least the incumbent's, strictly fewer false alarms, cost at most 1.2x. The report is `BLOCKED` when the data spans fewer than 7 days or does not cover 2 or 3 repositories. The exit code is 2 unless `PASS`. The report lists, per PR, each reviewer's fixes, false alarms, tokens and cost. Requirement: `mvp:RF-08`.
