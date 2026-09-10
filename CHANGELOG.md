# Changelog

## 0.30.10

### Patch Changes

- [#233](https://github.com/AgentsKit-io/code-review/pull/233) [`cd8aef5`](https://github.com/AgentsKit-io/code-review/commit/cd8aef5fee8e25e933b9fb386b406ef3deed5e56) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Exclude worker concurrency from the semantic review-policy fingerprint. Campaign preflight and publication now recognize the same completed SHA/policy even when their scheduling limits differ, preventing repeated reviews, comments and model costs. Meaningful policy changes still invalidate the identity.

## 0.30.9

### Patch Changes

- [#231](https://github.com/AgentsKit-io/code-review/pull/231) [`4c00bc8`](https://github.com/AgentsKit-io/code-review/commit/4c00bc8c6cfaf71927d11ecb0a70d4e43dbcb7cb) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Measure every batch before execution and split oversized files by immutable context packs. Reuse the source snapshot during planning, bound skeptic prompts, and preserve complete pack coverage through caching and consolidation.

  Recover one transient GitHub content 404 at the same SHA and support patch/diff sources. Correct skipped-PR and retry denominators in quality matrices, Codex token totals, baseline comparisons, and per-case evaluation matching. Emit current campaign checkpoints and blocked-cycle matrices; add single-PR campaign and provider-free preflight modes.

  Run Codex inference from a temporary directory with focused review instructions and ambient skills, plugins, shell, delegation and web search disabled. Retain read-only sandboxing and structured output while eliminating unrelated agent context overhead.

  Supply bounded, same-SHA unchanged stylesheets referenced by changed HTML to both analysis and skeptic verification, without treating them as changed-file coverage. This prevents local CSS findings from overlooking global rules; unavailable context stays explicit.

## 0.30.8

### Patch Changes

- [#229](https://github.com/AgentsKit-io/code-review/pull/229) [`955953c`](https://github.com/AgentsKit-io/code-review/commit/955953c35118fd5ad25fff58749e90944e99ec51) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Bind campaign checkpoints to the stable preflight manifest and package version so scheduled runs do not reject a prior terminal campaign as stale.

- [#229](https://github.com/AgentsKit-io/code-review/pull/229) [`955953c`](https://github.com/AgentsKit-io/code-review/commit/955953c35118fd5ad25fff58749e90944e99ec51) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Campaign workers now use a short recoverable pull-request lease with a parent heartbeat, preventing interrupted reviews from blocking the next campaign for hours.

- [#229](https://github.com/AgentsKit-io/code-review/pull/229) [`955953c`](https://github.com/AgentsKit-io/code-review/commit/955953c35118fd5ad25fff58749e90944e99ec51) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Campaign preflight now respects enabled batch plans for aggregate budgets, and incomplete lens executions receive one bounded retry before failing closed.

## 0.30.7

### Patch Changes

- [#227](https://github.com/AgentsKit-io/code-review/pull/227) [`16459cd`](https://github.com/AgentsKit-io/code-review/commit/16459cdd8ba0840ce79a08ca568e9ee5bde81a95) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Bind campaign checkpoints to the stable preflight manifest and package version so scheduled runs do not reject a prior terminal campaign as stale.

- [#227](https://github.com/AgentsKit-io/code-review/pull/227) [`16459cd`](https://github.com/AgentsKit-io/code-review/commit/16459cdd8ba0840ce79a08ca568e9ee5bde81a95) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Campaign preflight now respects enabled batch plans for aggregate budgets, and incomplete lens executions receive one bounded retry before failing closed.

## 0.30.6

### Patch Changes

- [#225](https://github.com/AgentsKit-io/code-review/pull/225) [`5848b22`](https://github.com/AgentsKit-io/code-review/commit/5848b229c747437ee7965853a6e03bd8c27d632a) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Bind campaign checkpoints to the stable preflight manifest and package version so scheduled runs do not reject a prior terminal campaign as stale.

## 0.30.5

### Patch Changes

- [#223](https://github.com/AgentsKit-io/code-review/pull/223) [`4d67632`](https://github.com/AgentsKit-io/code-review/commit/4d6763215e1c56d5ecac17090e761045c30d8edd) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Use provider-call token efficiency for materially different pull-request sizes and record the comparison basis in quality matrices.

## 0.30.4

### Patch Changes

- [#221](https://github.com/AgentsKit-io/code-review/pull/221) [`604ebf2`](https://github.com/AgentsKit-io/code-review/commit/604ebf28dda5e5ae87d19f9ea6974974d21d6b30) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Make real campaign evidence trustworthy by validating Orca against the PR head SHA, exercising a real memory persistence round-trip, and accepting an explicit external quality baseline for speed and token measurements.

## 0.30.3

### Patch Changes

- [#219](https://github.com/AgentsKit-io/code-review/pull/219) [`66eba5f`](https://github.com/AgentsKit-io/code-review/commit/66eba5fd096fac97cae7f203763278d21ea01f9e) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Make the campaign-wide deadline configurable and honor it for each PR worker, so complete multi-batch reviews do not stop at the previous two-batch-derived timeout.

- [#219](https://github.com/AgentsKit-io/code-review/pull/219) [`66eba5f`](https://github.com/AgentsKit-io/code-review/commit/66eba5fd096fac97cae7f203763278d21ea01f9e) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Split large source projections with a provider-overhead safety margin before live execution, and give multi-pack reviews an aggregate analysis budget so generated files cannot fail after only a few safe packs. Plans now fail fast when aggregate analysis demand exceeds the declared budget.

## 0.30.2

### Patch Changes

- [#217](https://github.com/AgentsKit-io/code-review/pull/217) [`c158bdb`](https://github.com/AgentsKit-io/code-review/commit/c158bdb7a2ac3d45984ea2a7ed037ea40271e2fd) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Split large source projections with a provider-overhead safety margin before live execution, and give multi-pack reviews an aggregate analysis budget so generated files cannot fail after only a few safe packs. Plans now fail fast when aggregate analysis demand exceeds the declared budget.

## 0.30.1

### Patch Changes

- [#215](https://github.com/AgentsKit-io/code-review/pull/215) [`294512f`](https://github.com/AgentsKit-io/code-review/commit/294512fea2de4989e453ebf3661c19126d4cf941) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Allow the campaign command to receive the trusted local provider mode explicitly from Orca without accepting trusted execution credentials in the project configuration.

## 0.30.0

### Minor Changes

- [#212](https://github.com/AgentsKit-io/code-review/pull/212) [`11f8ea9`](https://github.com/AgentsKit-io/code-review/commit/11f8ea9d772fe0784c15dc79057759810d515bcd) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Partition oversized multi-line review targets into deterministic, source-line-preserving context chunks so complete PR coverage can proceed within provider budgets.

## 0.29.0

### Minor Changes

- [#210](https://github.com/AgentsKit-io/code-review/pull/210) [`db8748a`](https://github.com/AgentsKit-io/code-review/commit/db8748a24653138f48e5dc51a1799e982081c325) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Make the packaged campaign command the explicit owner of scheduled review publication and safe merging, including deterministic SHA-bound Orca evidence for each worker run.

## 0.28.0

### Minor Changes

- [#208](https://github.com/AgentsKit-io/code-review/pull/208) [`8d3f98c`](https://github.com/AgentsKit-io/code-review/commit/8d3f98cdaf64e16e7ce46cd1b9b44ce79dc1fb93) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a credential-free deterministic fault-injection harness for provider, SCM, storage, clock, budget, publication, and merge recovery paths.

## 0.27.0

### Minor Changes

- [#206](https://github.com/AgentsKit-io/code-review/pull/206) [`af04b40`](https://github.com/AgentsKit-io/code-review/commit/af04b400d75a67d0c9b761e710c751493cfccf3f) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Enforce configurable GitHub check policies and make pull-request review publication idempotent across retries and resume.

## 0.26.0

### Minor Changes

- [#204](https://github.com/AgentsKit-io/code-review/pull/204) [`10b67fb`](https://github.com/AgentsKit-io/code-review/commit/10b67fb82762dd6e3f4e3ec6e2f200c2cfed3e8d) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Produce SHA-bound run and campaign quality matrices with separated evidence classes, complete campaign terminal coverage, measured retry/wasted-call/time/token accounting, and configurable baseline regression gates.

## 0.25.0

### Minor Changes

- [#202](https://github.com/AgentsKit-io/code-review/pull/202) [`6db325d`](https://github.com/AgentsKit-io/code-review/commit/6db325df3ea33ef94484dd1499827d7e02bd0a29) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add bounded, repository/path/language/category-scoped approved-rule retrieval through the AgentsKit Retriever contract.

## 0.24.0

### Minor Changes

- [#200](https://github.com/AgentsKit-io/code-review/pull/200) [`99b27b9`](https://github.com/AgentsKit-io/code-review/commit/99b27b96d2a0d537475152e05513d32e9ae28870) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Reconcile review feedback deterministically into resumable, provenance-backed inactive candidate rules without automatically promoting knowledge.

## 0.23.0

### Minor Changes

- [#198](https://github.com/AgentsKit-io/code-review/pull/198) [`f764acc`](https://github.com/AgentsKit-io/code-review/commit/f764accca72777d83cbdd2878a8d0d1f109174ae) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Separate operational state, review cache, feedback, and approved knowledge storage; prevent provider transcripts, prompts, source, and secrets from entering permanent knowledge.

## 0.22.0

### Minor Changes

- [#196](https://github.com/AgentsKit-io/code-review/pull/196) [`d437efc`](https://github.com/AgentsKit-io/code-review/commit/d437efc80dc2d7575beef3399640de5442eb722a) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add validated hierarchical campaign, pull-request, context-pack, analysis, and verification budgets with explicit output and critical-verification reserves. Review evidence now retains provider token dimensions and pre-execution budget reservations.

## 0.21.3

### Patch Changes

- [#194](https://github.com/AgentsKit-io/code-review/pull/194) [`3a02b4c`](https://github.com/AgentsKit-io/code-review/commit/3a02b4cbc88ffc210768186c327090e3e8d50967) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Reuse validated review units across identical cycle executions with immutable identity fingerprints, provenance, and saved-token metrics.

## 0.21.2

### Patch Changes

- [#192](https://github.com/AgentsKit-io/code-review/pull/192) [`ce97df5`](https://github.com/AgentsKit-io/code-review/commit/ce97df5dae1fc3b59ca89badba834fd7f6225409) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Batch skeptical verification and fail closed when required verification evidence is missing.

## 0.21.1

### Patch Changes

- [#190](https://github.com/AgentsKit-io/code-review/pull/190) [`e132ecb`](https://github.com/AgentsKit-io/code-review/commit/e132ecbba0f28d5a84e89dbc51f2b90312468bfc) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a versioned semantic evaluation corpus and fail-closed quality-matrix coverage gates. Disabled memory is now reported as not applicable instead of being treated as missing evidence.

## 0.21.0

### Minor Changes

- [#188](https://github.com/AgentsKit-io/code-review/pull/188) [`37dbe7d`](https://github.com/AgentsKit-io/code-review/commit/37dbe7d87bb0d21dc139a0296ed9238da0911dbe) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Classify context packs from deterministic risk evidence and reserve additional correctness or security analysis for elevated-risk changes while keeping documentation and generated content on the low-cost path.

## 0.20.0

### Minor Changes

- [#186](https://github.com/AgentsKit-io/code-review/pull/186) [`5d41dfd`](https://github.com/AgentsKit-io/code-review/commit/5d41dfd4f6d79dcb456119324f3fbc961b629533) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Build auditable diff-first context packs with bounded adjacent and related-file context, exact changed-line anchors including deletions, and AgentsKit token-budget enforcement before every provider request.

## 0.19.0

### Minor Changes

- [#184](https://github.com/AgentsKit-io/code-review/pull/184) [`1c53222`](https://github.com/AgentsKit-io/code-review/commit/1c532222ff83847ef99fdc08496d1ce415c036e3) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Review every enabled quality dimension in one structured analysis call per context pack and report explicit category coverage.

## 0.18.0

### Minor Changes

- [#182](https://github.com/AgentsKit-io/code-review/pull/182) [`d0bab4f`](https://github.com/AgentsKit-io/code-review/commit/d0bab4f0238f11d723a71e37514fc4fbfc0996aa) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Execute preflighted pull requests through a bounded, resumable, failure-isolated campaign queue with deterministic terminal reporting.

## 0.17.0

### Minor Changes

- [#180](https://github.com/AgentsKit-io/code-review/pull/180) [`0ba0311`](https://github.com/AgentsKit-io/code-review/commit/0ba031130fba88752586e063b6c26f553809f46e) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a deterministic provider-free campaign command that discovers every configured pull request, reports eligibility and complete preflight outcomes, and permits worktree creation only for ready entries.

## 0.16.0

### Minor Changes

- [#178](https://github.com/AgentsKit-io/code-review/pull/178) [`14187ac`](https://github.com/AgentsKit-io/code-review/commit/14187ac04eeca95d4b4fba47fcf0cdb6564456a4) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Route GitHub ingestion, review state, publication, merge readiness, and revision-locked merge through the common SCM adapter.

## 0.15.0

### Minor Changes

- [#176](https://github.com/AgentsKit-io/code-review/pull/176) [`517779f`](https://github.com/AgentsKit-io/code-review/commit/517779fbadd6baad0dcfdec26c662a353a6ef6c6) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a provider-neutral SCM contract for change-request discovery, review publication, readiness, and revision-locked merge.

## 0.14.0

### Minor Changes

- [#174](https://github.com/AgentsKit-io/code-review/pull/174) [`6155fec`](https://github.com/AgentsKit-io/code-review/commit/6155fec7486b9bdc26be17430f13878f49849a44) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add typed provider failures, bounded jittered retries, adaptive concurrency, cancellation-aware backoff, and controlled circuit recovery.

## 0.13.0

### Minor Changes

- [#170](https://github.com/AgentsKit-io/code-review/pull/170) [`d857a58`](https://github.com/AgentsKit-io/code-review/commit/d857a5856fc14026056e3bb1c2027527ef8e87d9) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Expose validated model-provider capability metadata and conservative execution policy through the existing AgentsKit adapter registry.

## 0.12.0

### Minor Changes

- [#168](https://github.com/AgentsKit-io/code-review/pull/168) [`4f85ef0`](https://github.com/AgentsKit-io/code-review/commit/4f85ef08468fb779263b57ae84f0f6f44c03c35c) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add crash-safe campaign checkpoints, exclusive campaign and pull-request leases, deterministic resume, and persisted external-effect idempotency keys.

## 0.11.0

### Minor Changes

- [#166](https://github.com/AgentsKit-io/code-review/pull/166) [`c9ee837`](https://github.com/AgentsKit-io/code-review/commit/c9ee837dfa1f82326e2c6580e6d6d4a752f94c2a) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add the pure, fail-closed campaign lifecycle reducer with immutable state and deterministic event replay.

## 0.10.0

### Minor Changes

- [#164](https://github.com/AgentsKit-io/code-review/pull/164) [`ce41c10`](https://github.com/AgentsKit-io/code-review/commit/ce41c108484c61f7a443231f77c2d23a158f7362) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add versioned campaign, pull-request run, review-unit, event, budget, immutable identity, terminal outcome, and typed failure contracts.

## 0.9.0

### Minor Changes

- [#162](https://github.com/AgentsKit-io/code-review/pull/162) [`072bae3`](https://github.com/AgentsKit-io/code-review/commit/072bae3155c7bd41e1f8c11f1940b5db99bc3ee5) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add versioned quality baseline contracts, a reproducible v0.8.0 fixture baseline command, and accepted architecture decisions for the deterministic campaign engine.

## 0.8.0

### Minor Changes

- [#135](https://github.com/AgentsKit-io/code-review/pull/135) [`94db243`](https://github.com/AgentsKit-io/code-review/commit/94db2433181d8cc2b49ee00429819b0b633713ee) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a deterministic end-to-end review cycle with aggregate preflight, replay,
  live canary and labelled quality evaluation, crash-safe batch resume, immutable
  quality matrices, provider token evidence, and guarded publish/merge actions.

  Load only explicitly approved, bounded review rules from self-hosted AgentsKit
  memory and prove their effect with a live memory-on/memory-off quality canary.

  Reduce Codex CLI context waste by excluding user configuration and sending only
  changed-file context while preserving the unified patch for introduced-defect
  validation. Publish only from merged Changesets version pull requests.

## 0.7.18

### Patch Changes

- [#133](https://github.com/AgentsKit-io/code-review/pull/133) [`49c77c7`](https://github.com/AgentsKit-io/code-review/commit/49c77c77d222fef6ee4059ef1b9eb9d51fb449b7) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Keep preflight manifests aligned with review runs when policy overrides are supplied.

## 0.7.17

### Patch Changes

- [#130](https://github.com/AgentsKit-io/code-review/pull/130) [`38bcd23`](https://github.com/AgentsKit-io/code-review/commit/38bcd23f1512f59e166d7023bc750f310d387611) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Enforce the global review deadline even when a provider runtime leaves an aborted request pending.

## 0.7.16

### Patch Changes

- [#128](https://github.com/AgentsKit-io/code-review/pull/128) [`f142fab`](https://github.com/AgentsKit-io/code-review/commit/f142fab7a5b4545e3d24764f7e420a3e74e65721) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Fail fast and cleanly terminate local provider workers when a deadline or abort fires.

## 0.7.15

### Patch Changes

- [#126](https://github.com/AgentsKit-io/code-review/pull/126) [`0828a57`](https://github.com/AgentsKit-io/code-review/commit/0828a570ea2b6c794b86f18cb9a34dfc8fcfcbf4) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Run trusted-local providers from the review workspace while preserving the caller environment.

## 0.7.14

### Patch Changes

- [#124](https://github.com/AgentsKit-io/code-review/pull/124) [`2829683`](https://github.com/AgentsKit-io/code-review/commit/28296832ea07b5daf90522932333e155188ac493) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Make the packaged harness independent of the caller's working directory.

## 0.7.13

### Patch Changes

- [#122](https://github.com/AgentsKit-io/code-review/pull/122) [`125f4c4`](https://github.com/AgentsKit-io/code-review/commit/125f4c40a44ac55895f1c92043dea65f138bacfa) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Expose the deterministic review harness as a packaged CLI for Orca automation.

## 0.7.12

### Patch Changes

- [#118](https://github.com/AgentsKit-io/code-review/pull/118) [`f83b2f2`](https://github.com/AgentsKit-io/code-review/commit/f83b2f2ed31fc4e3d7cccdca429a8d8ff9f1de0b) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Keep operational preflight planning provider-free by disabling provider smoke checks.

## 0.7.11

### Patch Changes

- [#117](https://github.com/AgentsKit-io/code-review/pull/117) [`5d87717`](https://github.com/AgentsKit-io/code-review/commit/5d87717bbf18bbfa90c91b6af0bd2cd7fedccdc8) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a provider-free operational preflight that aggregates blockers before planning or live review.

## 0.7.10

### Patch Changes

- [#115](https://github.com/AgentsKit-io/code-review/pull/115) [`20283f4`](https://github.com/AgentsKit-io/code-review/commit/20283f408e1e06ae415c04b9c3cc9fdc468332be) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Harden harness state transitions and add atomic CLI persistence for canary retries and resumable batches.

## 0.7.9

### Patch Changes

- [#113](https://github.com/AgentsKit-io/code-review/pull/113) [`6f4e53d`](https://github.com/AgentsKit-io/code-review/commit/6f4e53d903a30d2ed68a5c15c389999e713b00c5) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Extend the deterministic harness with bounded canary retries, resumable batch state, and provider-free replay execution.

## 0.7.8

### Patch Changes

- [#108](https://github.com/AgentsKit-io/code-review/pull/108) [`29d2fe6`](https://github.com/AgentsKit-io/code-review/commit/29d2fe68f6121842f8bb061a50ecf62c48120df0) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add deterministic harness primitives for blocker sweeps, immutable run contracts, and fail-closed live canary validation.

## 0.7.7

### Patch Changes

- Allow full-profile batch artifacts to be publishable when every required lens completes, and align the Ink dependency with the current AgentsKit core contract.
- Release prepared through the repository's Changesets publishing workflow.

## 0.7.6

### Patch Changes

- [#104](https://github.com/AgentsKit-io/code-review/pull/104) [`1a29c23`](https://github.com/AgentsKit-io/code-review/commit/1a29c234a1b7fb5258f43a671cf2665813be9e54) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Fix batch planning and worker runs producing different policy fingerprints when workers use the fast profile, allowing valid complete batches to be consolidated.

- [#104](https://github.com/AgentsKit-io/code-review/pull/104) [`1a29c23`](https://github.com/AgentsKit-io/code-review/commit/1a29c234a1b7fb5258f43a671cf2665813be9e54) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Keep planner manifests and fast batch artifacts on the same normalized policy fingerprint when batching is enabled.

- [#104](https://github.com/AgentsKit-io/code-review/pull/104) [`1a29c23`](https://github.com/AgentsKit-io/code-review/commit/1a29c234a1b7fb5258f43a671cf2665813be9e54) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Validate quality-matrix input at the CLI boundary and emit structured fail-closed reports for malformed runner artifacts instead of uncaught runtime errors.

## 0.7.5

### Patch Changes

- [#102](https://github.com/AgentsKit-io/code-review/pull/102) [`ffdf258`](https://github.com/AgentsKit-io/code-review/commit/ffdf258c1528ec2fa19163de2dc6e1b5d19106d9) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Fix batch planning and worker runs producing different policy fingerprints when workers use the fast profile, allowing valid complete batches to be consolidated.

- [#102](https://github.com/AgentsKit-io/code-review/pull/102) [`ffdf258`](https://github.com/AgentsKit-io/code-review/commit/ffdf258c1528ec2fa19163de2dc6e1b5d19106d9) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Validate quality-matrix input at the CLI boundary and emit structured fail-closed reports for malformed runner artifacts instead of uncaught runtime errors.

## 0.7.4

### Patch Changes

- [#100](https://github.com/AgentsKit-io/code-review/pull/100) [`df7632c`](https://github.com/AgentsKit-io/code-review/commit/df7632c59184df7847706f399bf513641d7701e2) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Validate quality-matrix input at the CLI boundary and emit structured fail-closed reports for malformed runner artifacts instead of uncaught runtime errors.

## 0.7.3

### Patch Changes

- [#98](https://github.com/AgentsKit-io/code-review/pull/98) [`d5b229d`](https://github.com/AgentsKit-io/code-review/commit/d5b229d855db1f87654fbe975e63f051db249353) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Honor an explicit `--mode` CLI override when resolving project configuration, while continuing to reject `trusted-local` from project config and CI.

## 0.7.2

### Patch Changes

- [#96](https://github.com/AgentsKit-io/code-review/pull/96) [`cc239fc`](https://github.com/AgentsKit-io/code-review/commit/cc239fcce33473bcfa06e3d52d22e9908b73969c) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Expose the quality matrix as an executable package binary so external runners such as Orca can invoke it without relying on repository npm scripts.

## 0.7.1

### Patch Changes

- [#94](https://github.com/AgentsKit-io/code-review/pull/94) [`11a9dfd`](https://github.com/AgentsKit-io/code-review/commit/11a9dfdf7127e5588ec77f05751de394a6fa22a1) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Review safe repository dotfiles and environment example templates while continuing to fail closed on real secret files.

## 0.7.0

### Minor Changes

- [#92](https://github.com/AgentsKit-io/code-review/pull/92) [`bd1a503`](https://github.com/AgentsKit-io/code-review/commit/bd1a503489fc4830096944b20d1cbc6b55a72972) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add an automatic quality matrix and baseline comparison for review coverage, findings, safety, reliability, speed, token efficiency, batches, memory, configuration, comments, and integrations.

## 0.6.0

### Minor Changes

- [#90](https://github.com/AgentsKit-io/code-review/pull/90) [`ab82590`](https://github.com/AgentsKit-io/code-review/commit/ab82590713dd6fa0ece33676c25cbc9551b11cee) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Connect self-hosted project memory and configurable GitHub comment rendering to the runtime, with bounded persistence and fail-closed malformed-memory handling.

## 0.5.1

### Patch Changes

- [#88](https://github.com/AgentsKit-io/code-review/pull/88) [`cb0b3b6`](https://github.com/AgentsKit-io/code-review/commit/cb0b3b63fcfc59b3e23509ba66f00cf889c17fda) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Make configured batch planning widen GitHub PR discovery before partitioning, carry batch policy into the executable review configuration, and recognize TSV files as reviewable text.

## 0.5.0

### Minor Changes

- [#86](https://github.com/AgentsKit-io/code-review/pull/86) [`295477d`](https://github.com/AgentsKit-io/code-review/commit/295477d90beaa49283c5e07e4ba3f1a2bab7255f) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a typed, Zod-validated `code-review.config.ts` API with presets, project
  config loading, stable fingerprints, JSON Schema generation, and `--config`
  and `--config-schema` CLI support. Existing `.agentskit-review.json` behavior
  and flags remain compatible.

## 0.4.3

### Patch Changes

- [#80](https://github.com/AgentsKit-io/code-review/pull/80) [`eb8a815`](https://github.com/AgentsKit-io/code-review/commit/eb8a815e6b4765c3e9e9353dd3d617fed8127149) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Fix GitHub PR batch planning so `--batch-size` reads the full PR file manifest before partitioning, instead of applying the default single-run file cap and silently omitting batches.

## 0.4.2

### Patch Changes

- [#78](https://github.com/AgentsKit-io/code-review/pull/78) [`f50bb3d`](https://github.com/AgentsKit-io/code-review/commit/f50bb3daceb7e48c8cd1401e47352ebd33000a8f) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Make provider-call preflight guidance consistent with demand-driven skeptical verification and document the best-effort estimate semantics.

## 0.4.1

### Patch Changes

- [#73](https://github.com/AgentsKit-io/code-review/pull/73) [`f99c9a3`](https://github.com/AgentsKit-io/code-review/commit/f99c9a37478440b7030c33ac480746db4204d0ef) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Add a deterministic continuous-improvement benchmark for clean, required-lens-failure, and deadline review behavior.

- [#73](https://github.com/AgentsKit-io/code-review/pull/73) [`f99c9a3`](https://github.com/AgentsKit-io/code-review/commit/f99c9a37478440b7030c33ac480746db4204d0ef) Thanks [@EmersonBraun](https://github.com/EmersonBraun)! - Automate version pull requests, GitHub releases, and npm trusted publishing without a long-lived npm token. Stabilize OpenCode ACP protocol fixtures without weakening their timeout coverage.

All notable changes will be documented here. This project follows Semantic Versioning.

## [Unreleased]

## [0.4.0] - 2026-09-05

### Added

- Added machine-readable preflight manifests for reviewable and unreviewed files, with stable file-batch planning for external orchestration.
- Added private JSON review-result artifacts and SHA/policy-bound batch-coverage primitives for safe Orca aggregation.
- Added fail-closed consolidation: every batch artifact must match the immutable PR/SHA/policy/file manifest and have complete lens evidence before a single review can be published.
- Added CLI consolidation and publication gates so Orca can create exactly one review only from a current, complete consolidated artifact.

### Changed

- Expanded reviewable product files to include HTML, CSS, Markdown, and MDX.
- Made GitHub inline findings agent-actionable with correction rationale, required change, acceptance check, and verification confidence.
- Reworked the persistent PR walkthrough into a compact CodeRabbit-style status card; finding detail now lives only on the relevant inline review comments.

### Security

- Reject GitHub publication from a partial review batch; only a complete consolidated review may post.
- Document the intentionally local, private batch-artifact writes so CodeQL does not misclassify serialized PR metadata as executable file access.

## [0.3.0] - 2026-08-30

### Added

- Added global cancellation deadlines, provider health preflight, a circuit breaker, and bounded execution evidence.
- Added the explicit `fast` profile with a single required-lens batch for lower latency and predictable calls.
- Added CI Action inputs for profile, deadline, and health-check policy.

## [0.2.3] - 2026-08-30

### Fixed

- Stop issuing additional provider calls after a terminal authentication failure; reviews still fail closed without spending one failed call per lens.

## [0.2.2] - 2026-08-29

### Added

- Added a GitHub Release workflow for tag-verified npm Trusted Publishing with OIDC and provenance.

### Fixed

- Prevented Codex authentication, timeout, and process failures from being retried as output-schema compatibility failures.
- Documented and exposed explicit trusted-local mode for logged-in Codex/Claude CLI workflows.
- Raised the default Codex local-worker deadline to five minutes and made GitHub PR file budgets enforceable and fail-closed.
- Bounded GitHub Action calls, propagated Claude OAuth credentials, made review fingerprints version-aware, paginated comment reconciliation with a fail-closed cap, and bounded GitHub API responses.

## [0.2.1] - 2026-08-29

### Fixed

- Applied Codex timeout defaults in direct library usage, bounded GitHub PR metadata/content ingestion, and transient-only GitHub GET retries.
- Added Ollama request deadlines and integration coverage for rate limits, posting failures, stalled requests, and large PR limits.

## [0.2.0] - 2026-08-29

### Changed

- Added strict versioned `.agentskit-review.json` policy with lens coverage, budgets, thresholds, context, and safe CI precedence; incomplete profiles require explicit local opt-in.
- Hardened the shared local CLI worker with cancellation, process-tree cleanup, isolated temporary environments, bounded output, and redacted diagnostics.
- Added bounded source snapshots with infrastructure/configuration file support, denylisted sensitive paths, symlink checks, input limits, and data-boundary-aware secret redaction.
- Added provider-free `--plan`/`--dry-run` preflight with explicit file/byte/call budgets, bounded retries, CLI concurrency defaults, and fail-closed required-lens coverage.
- Made reviews fail closed when any reviewable file has no successful primary lens or cannot be ingested; advisory mode now suppresses finding-based failures only, never source/provider/execution failures.
- Added primary-lens execution coverage to review summaries so partial provider degradation is visible.
- Repositioned the CLI and GitHub Action as provider-neutral.
- Made provider selection explicit and removed provider-specific model defaults.
- Added bounded GitHub review reconciliation with SHA/policy fingerprints, incremental compare scope when the prior SHA is an ancestor, fork-safe skip behavior, and idempotent summary updates.
- Added experimental Grok Build CLI ACP support with isolated capability denial, versioned output validation, bounded invalid-output retry, and offline lifecycle fixtures.
- Added experimental OpenCode CLI ACP support with the same isolated, versioned, bounded worker contract and offline lifecycle fixtures.
- Added provider-specific Grok/OpenCode headless transports with explicit local-only ACP fallback via `--transport auto`.
- Added package metadata, CLI help, open-source governance, and contribution guidance.
