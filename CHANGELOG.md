# Changelog

## 0.7.7

### Patch Changes

- Allow full-profile batch artifacts to be publishable when every required lens completes, and align the Ink dependency with the current AgentsKit core contract.

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
