# Continuous improvement cycles

Each cycle improves one measurable review-process hypothesis. A cycle is not a request to remove every model suggestion from the repository.

## Cycle contract

Before changing behavior, record one hypothesis, its acceptance criteria, a fixed benchmark set, and the decision rule. A confirmed high-severity finding in the cycle scope, incomplete coverage, or a failed gate blocks publication. Medium and low findings outside the hypothesis enter the backlog.

## Baseline benchmark

Run these deterministic, credential-free cases before and after every process change:

| Case | Fixture | Expected evidence |
| --- | --- | --- |
| Clean review | `test/fixtures/review/good.ts` | Complete `APPROVE`, all enabled lenses succeed. |
| Lens failure | `CODEX_FIXTURE_FAIL_CATEGORY=security` | Incomplete, fail-closed result with missing required-lens evidence. |
| Deadline | `CODEX_FIXTURE_HANG=1` | Incomplete, blocking result artifact; no candidate finding is accepted without skeptical verification. |

The benchmark records elapsed time, provider calls, failed/skipped calls, execution coverage, verdict, incomplete state, and deadline state. It is run with the fixture provider; representative live runs are a separate acceptance check, never a replacement for this baseline.

Run it with `npm run benchmark:cycle`. To capture the stable schema-v2 comparison point, run `npm run benchmark:baseline -- --library-version 0.8.0`; see [the baseline protocol](baseline-protocol.md). Both commands exit non-zero when a case stops preserving its fail-closed behavior.

## Quality matrix

The benchmark proves process safety; it does not prove that model findings are correct. `agentskit-review-cycle` therefore runs the versioned labelled corpus with the live provider in addition to the real PR, then emits a SHA-bound `QualityInput` and immutable matrix. The matrix requires every area to score at least 3/4 and enforces absolute safety, completeness, inline-comment, and silent-failure gates. See `docs/quality-matrix.md` for the evidence contract.

Enabled learning also requires a live A/B canary. The memory-on arm must apply an explicitly approved rule and detect the labelled policy violation; the memory-off arm must not invent that project policy. Precision and bounded token overhead remain gates. Persisting transcripts or pending feedback alone is not evidence of learning. Runtime state, review cache, feedback, and permanent knowledge are separate local stores; the knowledge store accepts only bounded approved rules and never stores source, prompts, secrets, or provider transcripts.

Feedback reconciliation is deterministic and resumable. It represents accepted, fixed, rejected, unresolved, obsolete, and pending outcomes, deduplicates by stable feedback identity, and emits provenance-backed candidate rules only after repeated compatible accepted/fixed evidence. Candidates are always inactive and require explicit approval before entering permanent knowledge; pull-request content alone cannot promote a rule.

Permanent rules are injected through the AgentsKit `Retriever` contract with a
bounded scope for repository, path, language, and review category. Context packs
receive only matching, deduplicated rules within the configured rule/token
limits; an absent repository scope fails closed for repository-specific rules.

Completed review units are also cached locally by an immutable fingerprint over the source, diff, base revision, policy, prompt, model, and relevant knowledge identities. Only schema-valid, passed records are reusable; corruption, stale identity, and unvalidated records fail closed. Cycle summaries and quality inputs report cache hits, misses, and saved tokens so reuse is measurable rather than assumed.

Every live cycle also compiles a hierarchical budget before execution. Campaign and pull-request scopes retain capacity for output and critical verification; context-pack, analysis, and verification calls reserve their estimated input before concurrent execution. Provider usage is copied into the evidence and quality matrix by dimension when available, while missing dimensions stay explicitly unavailable.

`review.maxTokens` limits a child review invocation; `review.globalMaxTokens`
(default 10,000,000) limits the entire single-PR cycle, including failed attempts,
the labelled corpus, and both learning A/B arms. `usage.json` reserves capacity
before each child starts and settles it using reported input plus output tokens.
Cached input and reasoning are subsets, never additional charges. Missing usage
retains its reservation and makes recorded totals unavailable. Crash recovery
keeps that journal; cached artifacts retain their original evidence but incur no
new provider charge. `cycle-summary.json` includes full-cycle wall time, including
preflight and publication. The default live corpus includes positive, clean,
reduced-motion, and generated-declaration regression cases.

## Closed cycle

1. Run and store the baseline benchmark.
2. Diagnose one root cause and define the smallest change set.
3. Implement the change with a regression test.
4. Re-run the same benchmark and compare the listed evidence.
5. Run `npm run check`, `npm pack --dry-run`, and `ak-verify run --config .codex/verification.json --json`; record its run ID and require its current state to be `COMPLETE`.
6. Review only the cycle diff. Confirmed highs in scope block; unrelated medium/low findings enter backlog.
7. Add a Changeset for public behavior, open/merge the version PR, then let trusted publishing create the npm package and GitHub release.

## Release boundary

A cycle can be locally validated without publishing. Publishing requires the repository workflow to be pushed, GitHub Actions to be allowed to create the Changesets version PR, npm Trusted Publishing to be configured, and the version PR to merge. These are external prerequisites; they are reported separately from benchmark evidence.
