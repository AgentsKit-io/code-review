# Code Review operations guide

This guide is the repository-native reference for running AgentsKit Code Review locally and in CI. The CLI is the source of truth for flags; run `agentskit-review --help` against the version or commit you use.

## Provider and credential choices

For a bounded production canary, run `agentskit-review-campaign --config /absolute/code-review.config.json --pull 123 --output /absolute/campaign.json --quality-output /absolute/quality.json`. Add `--preflight-only` to collect source and budget blockers without model calls. Omit `--pull` for the configured repository campaign; posting and merging still require their explicit flags.

Batch size is a maximum. Every batch is measured before execution, and a single oversized file can span multiple context-pack batches. Every pack must be present at consolidation. Impossible single packs remain blocked; source completeness and token gates are never suppressed. See [ADR-0006](adr/0006-measured-batch-completion.md).

Review identity excludes execution concurrency: preflight and workers can schedule differently without creating a different semantic policy. Engine version, source SHA, review rules and substantive budgets still identify the review. Repeating a completed SHA/policy must skip before downloading source or calling a model.

Publication failures do not invalidate completed analysis. The cycle retains its review and quality decision and reports the publication phase separately. After an uncertain GitHub write, the adapter checks bounded history for the exact marked body before accepting delivery; it never blindly repeats the POST. `--publish-result <consolidated.json> --post` validates the current SHA and complete policy before reconciling both configured channels, including a missing walkthrough. An unchanged repeat performs no POST or PATCH. Inline-only policies use review history for idempotency; disabling both channels produces no remote comments.

On same-identity cycle resume, successful corpus and learning evaluations are reused only when their input/configuration, engine entry point, approved-rule context and artifact hashes match. Prior usage remains charged and the original cycle clock is not reset. Changed, missing or corrupt evidence is measured again within the remaining budget. Batched policy identity includes optional lenses, thresholds, comment settings and merge-check policy; changing any of these requires new evidence.

Codex inference runs in a temporary directory with focused review instructions, ambient skills/plugins disabled, and no shell, delegation or web search. Read-only sandboxing and structured output remain enabled. This reduces unrelated agent context; actual usage is still measured.

For changed HTML, SCM ingestion can include up to four unchanged local linked stylesheets (64 KiB each, within the source budget) at the same head SHA. They are context for analysis and skepticism, not extra reviewed files. Remote/sensitive paths are excluded and unavailable context is explicit. This is one-hop context, not a complete dependency graph: quality corpus scores do not replace auditing real findings against the surrounding application.

Single-lens, multidimensional and skeptical review share the same evidence policy: generated API types do not prove missing runtime refinements or state-transition guards. Runtime findings need implementation evidence; generated files remain reviewable for actual type changes. The live corpus and memory A/B use the same full review profile as PR batches, including an unhinted dense API-report regression. These checks reduce known noise; they do not establish zero false positives in arbitrary PRs.

| Provider class | Examples | Secret or login | Network boundary |
|---|---|---|---|
| Logged-in local CLI | `codex-cli`, `claude-cli`, `grok-cli`, `opencode-cli` | Existing local login | Provider CLI policy |
| Hosted API | `openai`, `anthropic`, `gemini`, `mistral`, `groq` | Repository/org secret | Selected code reaches provider |
| Local model | `ollama` | Usually none | Host or runner network only |
| Gateway | `openrouter`, custom `--base-url` | Gateway secret | Gateway policy and routing |

Credential precedence is `--api-key`, `LLM_API_KEY`, then `<PROVIDER>_API_KEY`. Prefer environment variables and GitHub secrets: process arguments may be visible to other processes or captured by diagnostics. The composite Action forwards its secret through `LLM_API_KEY` and never adds it to CLI arguments.

Do not run hosted review on code whose policy forbids external processing. A local model reduces external disclosure but does not remove the need to secure the runner, logs, cache, and generated SARIF.

## Provider registry and doctor

Provider IDs are versioned registry entries. `grok` is the xAI API adapter, while `grok-cli` and `opencode-cli` are stable local CLI providers. `--list-providers` prints registry metadata and dynamically discovered API factories, including each support level (`stable`, `experimental`, or `unsupported`), transport, and model requirement.

Each entry also carries a validated capability contract for structured output,
token accounting, cancellation, prompt caching, context limits, sessions, safe
concurrency, and request timeout. Execution defaults use that contract rather
than provider-name checks. Missing metadata is conservative: unsupported
optimizations stay off, context remains unknown, and concurrency falls back to
one. Explicit `AdapterFactory.capabilities` hints from AgentsKit can refine
structured-output and usage support without introducing another model layer.

Use the offline doctor before execution:

```sh
npx --yes github:AgentsKit-io/code-review doctor --provider codex-cli
npx --yes github:AgentsKit-io/code-review doctor --provider openai --model gpt-4o --json
```

It checks the named executable and version, transport, model requirement, configuration mode, and credential presence without making a model request. API keys are represented only as `configured` or `missing`; they are never printed. Local CLI credentials are represented as login-managed because login storage is provider-specific. `doctor --live` is the explicit provider smoke-test path; normal Codex reviews run the same bounded smoke check before analysis. Unknown local CLI versions warn during local runs and fail in CI. Doctor exits `0` when checks pass, `1` when a provider check fails, and `2` for invalid usage.

## SCM boundary

The public internal contract normalizes change-request discovery, metadata,
complete diffs, review state, inline/summary publication, merge readiness, and
revision-locked merge. Adapters declare every capability; requesting an
unsupported operation throws `UnsupportedScmCapabilityError`. Platform payloads
and credentials stay inside adapters rather than entering deterministic core
contracts. The GitHub adapter owns ingestion, bounded review-state inspection,
inline and summary publication, conservative merge readiness, and
revision-locked normal/admin merge. GitLab is future work and is not supported
until an adapter passes the same contract suite.

Merge readiness also reads bounded review history. An outstanding request for changes blocks merging even when checks pass or its reviewed SHA predates the current commit. Comments do not clear a request; a later approval by that reviewer or dismissal of that request does. Missing decision identity or truncated history fails closed.

## First local setup

```sh
git clone https://github.com/AgentsKit-io/code-review.git
cd code-review
npm install
npm run check
npx --yes github:AgentsKit-io/code-review --provider opencode-cli --transport acp --model openai/gpt-4o --no-fail
```

The last command requires an installed and authenticated OpenCode CLI. For a
credential-free verification, `npm run check` uses only the committed offline
fixtures. Precedence is explicit CLI flags, then the repository's
`.agentskit-review.json` policy, then safe defaults; the project file never
selects a trusted execution mode or carries credentials.

## Grok Build CLI via ACP

`grok-cli` is stable and uses `--transport acp` by default. It
starts `grok agent stdio --no-auto-update`, performs the ACP initialize,
authentication (when advertised), session, prompt, update, shutdown, and exit
sequence, then emits one `submit_findings` tool call. The worker accepts only a
`schemaVersion: 1` envelope with valid findings; malformed output gets one
bounded retry.

In the default `isolated` mode, provide `XAI_API_KEY` through the environment
or `--api-key`; the selected key is copied only into the temporary worker
environment. Existing `grok login` state is available only with explicit
local-only `--mode trusted-local`. Filesystem writes, terminal, MCP, plugin,
and subagent requests are denied, and the worker never uses the checkout as
its working directory. `doctor --provider grok-cli` checks executable/version
availability without making a model request. Headless mode is documented below
and must be selected explicitly.

## OpenCode CLI via ACP

`opencode-cli` is stable and uses `--transport acp` by default.
It starts `opencode acp`, performs the ACP initialize, session, prompt, update,
shutdown, and exit sequence, then emits one validated `submit_findings` tool
call. When `--model` is provided it is passed as OpenCode's `--model` option.
The worker allows no filesystem writes, terminal, MCP, plugin, or subagent
requests and retries malformed output once.

In the default `isolated` mode, provide `OPENCODE_API_KEY` through the
environment or `--api-key`; the selected key is copied only into the temporary
worker environment. Existing OpenCode login/configuration state is available
only with explicit local-only `--mode trusted-local`. The CLI does not install
OpenCode automatically.
`doctor --provider opencode-cli` checks executable/version availability without
making a model request. Headless mode is documented below and must be selected
explicitly.

## Grok and OpenCode headless transport

Headless mode is explicit with `--transport headless`. Grok uses
`grok --no-auto-update -p <prompt> --output-format json`; OpenCode uses
`opencode run --format json [--model provider/model] <prompt>`. Their output
framings are parsed separately and normalized to the same strict
`schemaVersion: 1` envelope. Surrounding logs are bounded and tolerated only
when the validated envelope can still be recovered.

`--transport auto` is a local convenience for these two providers:
it tries ACP first, reports the reason on stderr, then tries the provider's
headless command. It is rejected in CI so a pipeline cannot silently change
transport. Both paths use the same isolated worker timeout, output cap,
cancellation, temporary working directory, selected-credential injection, and
redacted diagnostics. Neither path installs a provider CLI automatically.

The executable compatibility source of truth is
[`provider-compatibility.json`](./provider-compatibility.json). It lists the
stable providers, every supported transport, required lenses, minimum version,
and the offline fixture that proves each cell. A provider remains experimental
until its registry entry, matrix, fixtures, and doctor checks are all green.

## pre-commit integration

The root `.pre-commit-hooks.yaml` exposes `agentskit-review` as a Node hook. It uses `pass_filenames: false` because the CLI reviews a Git diff, explicit paths, a pull request, or stdin rather than interpreting positional filenames. It is confined to the `manual` stage by default so cloning the hook does not silently add model calls to every commit.

Consumer configuration must select a provider through `args`. Keep credentials in the provider login or environment; never place API keys in `.pre-commit-config.yaml`. Before overriding the hook to `stages: [pre-push]`, decide whether findings are advisory, set a file budget, and confirm that provider latency and data handling are appropriate for every contributor.

The default diff base remains `origin/main`. A pre-commit invocation does not mean the input is limited to the Git staging area. Set `--base` explicitly when the repository uses another integration branch.

## Versioned review configuration

The preferred developer-facing format is a typed `code-review.config.ts` loaded
with `--config`. It uses the same Zod contracts as the CLI, supports presets,
and fails before provider execution when invalid. Use `--config-schema` to emit
JSON Schema for editor autocomplete. JavaScript/ESM and the legacy
`.agentskit-review.json` format remain supported.

```ts
import { defineConfig } from "@agentskit/code-review";

export default defineConfig({
  target: { repository: "owner/repository" },
  review: {
    provider: "codex-cli",
    lenses: { correctness: true, security: true, tests: true },
    context: { adjacentLines: 40, maxRelatedFiles: 1, maxTokens: 16000, reserveForOutput: 2000 },
  },
  memory: { enabled: true, provider: "self-hosted" },
  comments: { renderer: "coderabbit-inspired", language: "en" },
  checks: { mode: "required" },
});
```

The `checks` policy is evaluated by the SCM adapter immediately before merge:
`required` requires at least one reported check and all reported checks to be
completed successfully (neutral and skipped are accepted); `reported` applies
the same result validation but allows zero checks; `named` requires every exact
name in `names` and ignores unrelated runs; and `disabled` always blocks merge.
The policy is part of the immutable configuration fingerprint, so changing it
requires a fresh review and publication. This keeps check behavior explicit
without coupling the review engine to GitHub payloads.

Publication is marker-idempotent for both summary comments and pull-request
reviews. On retry or resume, the adapter searches bounded review history for
the current SHA and policy fingerprint before posting; a matching review is
reused, while truncated history blocks publication because duplicate prevention
cannot be proven.

Use a strict `.agentskit-review.json` at the repository root for review policy.
It requires `configVersion: 1` and supports a `full` or `fast` profile. Both use
one structured analysis per normal context pack: full covers every enabled dimension,
while fast limits the pass to required correctness, security, and tests with one vote
and no retry. Every result records enabled and completed categories; a missing required
category is incomplete and cannot approve. The config also supports lens policy (`enabled` and
`required` per built-in lens), votes, retries, thresholds, file/byte/call,
concurrency and global-deadline budgets, conventions, and bounded context selection. Diff reviews
project changed hunks with configured adjacent lines instead of sending complete files by default;
small source/test pairs may share one pack. AgentsKit token budgeting covers the system prompt,
tool schema, and exact request before provider execution. Plans and results retain pack membership,
included ranges, expansion, estimated input tokens, and output reserve. All built-in lenses
are enabled by default; correctness, security, and tests are required.
The shared local worker also accepts bounded `timeoutMs` and `maxOutputBytes`
settings; absolute ceilings are always enforced.

## Semantic file grouping (opt-in)

`createCodeReviewAgent({ context: { grouping: 'semantic' } })` replaces the default
same-basename-test-pair/local-import heuristic with one model call that clusters changed
files by index (paths and line counts only, never file content) before packing — for
relationships the heuristic cannot see, such as a header and its implementation in a
different-language pair, or a schema and its generated code. It only fires above
`groupingMinFiles` (default 4) changed files and `groupingMinLines` (default 200)
combined lines; below that, or on any failure of the grouping call itself, grouping
falls back to the heuristic. **`--plan`/`--dry-run` always uses the heuristic**, even
when `semantic` is configured and thresholds are met — the preflight plan is a
documented, tested provider-free contract, and semantic grouping is a real model call;
only an actual `review()`/CLI run performs it, so a `--plan --json` preview of pack
membership is an approximation in that mode, not a guarantee of the exact packs the
real run will use. Files referenced outside the valid index range, or duplicated across
groups, are dropped rather than trusted — every real file still lands in exactly one
group, defaulting to its own singleton group if the model omitted or mis-referenced it.

## Per-language review rules (opt-in)

`createCodeReviewAgent({ rules: { enabled: true } })` resolves a per-file review
checklist by glob and injects it alongside `conventions` for every file in a context
pack, deduplicated across files that share a language. Precedence: a `.agentskit-review/rules.json`
in the project root, then `~/.agentskit-review/rules.json`, then a built-in system
checklist (`agents/code-review/rules.ts` — TypeScript/JavaScript, Python, Go, Rust,
Java/Kotlin, Terraform, GitHub Actions workflows, YAML, JSON, and a general default).
A project/global rule file entry is `{ "rules": [{ "path": "<glob>", "rule": "<text>",
"mergeSystemRule": false }] }`; `mergeSystemRule: false` (default: merged) replaces the
matching system checklist instead of appending to it. `rules.maxChars` (default 4000)
bounds the combined resolved-rules text per pack, with a truncation warning emitted the
same way as an over-long `conventions` file. This option is **off by default** — enabling
it changes prompt content (and cost) for every file, so it is not turned on silently on
upgrade. `src/review-rules.ts`'s `resolveRuleForFile(path, layers)` can be called
directly to see which rule, and from which layer, would apply to a given file.

Risk classification is provider-free and records every contributing signal. Documentation and
generated-only packs are `low`; ordinary source and tests are `normal`; public contracts, IO, and
repository-control files are `high`; security, authorization, credential, and migration evidence is
`critical`. High packs receive one specialized correctness analysis and critical packs one combined
correctness/security analysis. Specialized analysis is included in call and token preflight. If a
required specialized category fails, the result is incomplete and cannot approve or publish.

Flags override file values. The file cannot contain credentials or executable
plugins. Provider, model, transport, trust mode, redaction, permissions, and
other execution inputs are rejected when supplied by the project config in CI.
An intentionally incomplete profile must say `incompleteProfile: true` and be
run locally with `--allow-incomplete`; it is rejected in CI and cannot become an
approval. Malformed, unknown, or unsafe configuration exits `2` before a model
request and diagnostics do not print config values.

Keep policy-only configuration in the file. Use trusted workflow flags or the
runner environment for provider selection, credentials, and execution mode.

When enabled in a project config, `memory.provider: "self-hosted"` is connected
to the AgentsKit runtime through a bounded repository-local `ChatMemory`. It
stores at most 200 messages/2 MiB, applies `retentionDays`, creates directories
with mode `0700`, writes the memory file with mode `0600`, and fails closed on
malformed records. The memory path is repository-relative. This is runtime
conversation memory; it is not automatic rule promotion or an approval signal.

Feedback reconciliation is separate from runtime memory. The cycle records
accepted, fixed, rejected, unresolved, obsolete, and pending outcomes in its
feedback store, then writes a resumable reconciliation checkpoint. Repeated
compatible accepted/fixed outcomes produce inactive candidate rules with
pull-request and commit provenance; candidates require explicit approval before
they can enter permanent knowledge.

Approved knowledge is retrieved through the AgentsKit `Retriever` contract, not
by injecting the whole store. Each context pack supplies its repository, paths,
languages, and enabled review categories; only matching rules are returned,
with global rules allowed, a maximum of 20 rules, and a default approximate
2,000-token rule budget. If repository scope is absent, repository-specific
rules are excluded. Rules are deduplicated and ranked by scope specificity.

The `comments` policy is applied by the GitHub reporter. It controls inline
emission, summary emission, renderer detail level, section inclusion, and
English/Portuguese section labels. Findings remain line-anchored and the
reporter continues to fall back to a non-approving `COMMENT` when GitHub rejects
the requested event.

## Deterministic scheduled cycle

Run `agentskit-review-campaign --config /absolute/path/code-review.config.ts
--output /private/path/campaign-report.json --post --merge` as the complete
scheduled campaign when the configuration explicitly enables safe merging.
Omit `--post` and `--merge` for a read-only discovery/execution run.
Provider trust mode is an execution input, not project configuration: pass
`--mode trusted-local` only from a trusted, pre-authenticated local runner;
otherwise the command defaults to isolated mode. The mode is included in the
campaign and worker identities so isolated and trusted runs cannot reuse each
other's checkpoints or review artifacts.
It validates the one project configuration, checks static provider health, discovers
all open change requests through the SCM adapter, and completes the provider-free
eligibility, source, and budget sweep before model execution. Only entries with
`worktreeAllowed: true` enter the bounded queue. The command persists atomic state
under `execution.statePath`, safely requeues an interrupted in-flight request, never
repeats terminal work, and reports every discovered request exactly once as skipped,
blocked, approved, changes requested, merge blocked, merged, or cancelled.

`execution.maxConcurrentPullRequests` bounds queue concurrency,
`execution.continueAfterPerPrFailure` controls fail-fast behavior, and
`execution.resumeIncompleteRuns` controls checkpoint reuse. Campaign outcome is
derived deterministically as complete, partial, blocked, or cancelled; an LLM is
never asked to choose orchestration state.

The campaign command generates the required SHA-bound Orca evidence for each
candidate and passes it to the worker. `--automation-id` is optional and defaults
to `agentskit-review-campaign`; an Orca automation should set its stable ID. The
campaign command then passes `--post` and `--merge` explicitly to each single-PR
worker. It never enables either mutation implicitly. The worker still requires
the configured quality, current-SHA, and successful-check gates before posting
or merging, and refuses merge when `merge.enabled` is false.

`agentskit-review-cycle` is the single-PR worker used by the campaign. Give it one PR, one
validated config, and a private run directory. The command collects all static
blockers before provider execution, locks the PR SHA and policy fingerprints,
runs replay and one canary, resumes only missing valid batches, consolidates the
complete result, validates self-hosted memory/feedback, and writes
`cycle-summary.json` even when blocked. The default labelled corpus is shipped
with the package and prevents a clean PR from turning detection, precision,
severity, and actionability into guessed scores.

For direct single-PR operation, supervise this process and independently require its exit code,
summary identity, complete batch state, and quality decision. It must not create
an ad-hoc batch script or accept a missing artifact as an empty review. Use a
unique run directory for a changed SHA or policy; reuse the same directory and
run ID only for crash recovery.

Configure `review.globalMaxTokens` for the entire single-PR cycle (default
10,000,000), distinct from the child-invocation limit `review.maxTokens`.
`review.globalDeadlineMs` bounds the entire cycle. Its private `usage.json`
includes reservations and settled consumption for retries, semantic evaluation,
and both memory A/B arms. Unknown usage stays charged and explicitly unknown;
resuming a run does not reset its budget. See [cycle accounting](continuous-improvement.md).

Run `npm run harness:faults` for the credential-free fault-injection gate. It executes seven
deterministic scenarios against the existing core contracts: provider timeout/authentication,
stale SCM identity, atomic checkpoint crash, clock drift during replay, budget exhaustion, and
crash-after-publication/merge side effects. The JSON report records expected and observed
dispositions, attempts, reused units, duplicate mutations, replay stability, and credential-free
execution. Every scenario must be `PASS`; the command uses temporary state and removes it before
returning. The same harness is also included in `npm test`.

`prompt` is the default context mode. To review an explicit repository snapshot,
set `context.mode` to `isolated-snapshot` and provide repository-relative
patterns such as `src/**` or `!src/generated/**`. Sensitive directories/files,
symlink escapes, binaries, and over-limit inputs are excluded and shown as
`UNREVIEWED`. The default snapshot ceiling is 100 files/5 MiB; the absolute
ceiling is 500 files/25 MiB. Whole-file inputs default to 256 KiB with a 1 MiB
absolute per-file ceiling. Changed files may exceed the old whole-file limit because only bounded
hunks are projected; the absolute 25 MiB ingestion ceiling still applies. Removed lines are retained
as anchored review evidence, while only actual additions or deletion anchors count as changed lines.

Remote and unknown provider boundaries receive high-confidence credential
redaction while preserving file and line context. `--allow-unredacted` is a
local-only escape hatch and is rejected in CI; never use it for untrusted code.

## Local Ollama review

Ollama serves its local API at `http://localhost:11434` by default. Verify the service without sending repository content:

```sh
curl --fail --silent http://localhost:11434/api/tags >/dev/null
```

Choose a tool-capable model that fits the host; tool calling is required because every lens submits a structured result. `qwen2.5-coder:7b` is a practical starting point for machines that cannot run the larger `qwen3-coder:30b`; model quality, context capacity, latency, and memory requirements vary. Pulling a model downloads several gigabytes and does not start a review:

```sh
ollama pull qwen2.5-coder:7b
```

Start with a bounded, advisory branch review:

```sh
npx --yes github:AgentsKit-io/code-review \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --base main \
  --base-url http://localhost:11434 \
  --max-files 10 \
  --concurrency 1 \
  --no-fail
```

The default source is the committed Git diff from `--base` to `HEAD`. It does not mean “only staged files,” even when invoked by a Git hook. Use `--paths` when complete files are the intended source. Avoid piping a unified Git patch through `--stdin`: stdin is treated as one source file rather than parsed into per-file changed ranges.

Seven primary lenses plus adversarial votes can be expensive for a local model, and each structured result can require more than one model turn. Begin with `--max-files 10`, `--concurrency 1`, and the default three votes. Reduce the file set before reducing verification depth. `--no-fail` makes surviving findings advisory; it does not hide an unavailable model, malformed response, unreadable source, or failed lens coverage.

For a self-hosted runner, bind Ollama only to the network interfaces required by the job, isolate the runner per repository trust boundary, and protect job logs and artifacts. Do not set a hosted gateway as `--base-url` and describe the run as local. Any optional telemetry or observability exporter creates a separate network boundary that must be approved explicitly.

Troubleshooting:

- **Connection refused:** start Ollama and repeat the `/api/tags` health check.
- **Model not found:** run `ollama pull <exact-model-id>` and pass the same id to `--model`.
- **Slow or out-of-memory:** choose a smaller model, reduce `--max-files`, and keep `--concurrency 1`.
- **Context overflow:** review narrower paths or a smaller branch diff; unreviewed files must remain visibly outside the result.
- **No findings with exit 0:** inspect the summary and successful/failed lens counts; advisory output is not proof that every file was reviewed.

## Incremental GitHub inline posting

`githubInlineReporter` (`agents/code-review/reporters.ts`) fetches the PR's existing
review comments before posting and drops any candidate whose line range overlaps one at
or above `policy.incrementalOverlapThreshold` (default `0.6`, an IoU over `[startLine,
endLine]`) — a second run on the same PR (a new commit, a re-triggered CI job) does not
repeat a finding still standing from a previous run; the summary body notes how many were
skipped this way. `policy.routeSeverityBelow` additionally folds findings at or below a
given severity into the summary instead of posting them inline, independent of the
overlap check. Fetching history is best-effort: a failure to read it (network error, rate
limit) never blocks posting — it only skips the overlap filter for that run. Both options
are library-level `GithubCommentPolicy` fields today, not yet exposed as CLI flags or
`.agentskit-review.json` config keys.

## GitHub Action permissions

The copy-ready workflow in [`examples/pull-request.yml`](../examples/pull-request.yml) requires:

```yaml
permissions:
  contents: read
  pull-requests: write
```

`contents: read` loads the PR source. `pull-requests: write` posts the batched review. Do not grant repository administration, package write, or workflow write. Fork PRs do not receive normal repository secrets; do not switch to `pull_request_target` merely to expose a model key, because that can execute or process untrusted contributions with privileged context.

The composite Action defaults to 17 files, 7 findings per file, 1,000 provider calls, and a 10-minute global deadline. `codex-cli` is accepted only with `mode: trusted-local` on a pre-authenticated self-hosted runner; use an API provider with a secret on GitHub-hosted runners.

Use environment protection or organization secrets for sensitive providers. Rotate a secret after suspected exposure and review provider usage plus GitHub audit logs.

When `--post` is used with `--pr`, the reviewer stores a hidden SHA and policy
fingerprint marker in the summary comment. Re-running the same head SHA with
the same policy skips provider calls and updates no comments. A new SHA uses
GitHub compare scope only when the previous marked SHA is an ancestor; a
missing marker, force-push, or changed fingerprint falls back to the full PR
file list. Fork PRs are reported as `SKIPPED` with exit `2` on this workflow
boundary; do not switch to `pull_request_target` to expose secrets. Summary
comments are reconciled by marker, while POST/PATCH failures remain visible for
manual retry.

## Advisory and blocking behavior

The Action is advisory by default: `fail-on-block: 'false'` adds `--no-fail`. Findings still post, but surviving blocker/high findings do not fail the job. `--no-fail` never suppresses provider, source, reporter, or review-execution errors. For enforcement:

```yaml
with:
  block: high
  fail-on-block: 'true'
```

Then require the workflow check in branch protection. CLI exit codes are:

| Exit | Meaning | Operator action |
|---:|---|---|
| `0` | Review completed; no blocking finding, or advisory mode | Inspect posted/report output |
| `1` | A finding at or above `--block` survived | Fix, dismiss with evidence, or change policy intentionally |
| `2` | Configuration, provider, source, or reporter failure | Inspect stderr; do not interpret as a clean review |

A model response that is malformed may drop one lens while other lenses continue; progress output and the final summary report successful and failed primary-lens counts. If any reviewable file cannot be ingested or has zero successful primary lenses, the pipeline stops before reporters run and exits `2`, including in advisory mode. Treat missing output or exit `2` as unavailable review, not approval.

Use `--plan --json` (or `--dry-run`) to run the source and budget preflight without a model request. The plan reports profile, batching, files, bytes, context-pack membership and expansion, estimated input tokens and reserve, enabled and required lenses, votes, retries, concurrency, deadline, estimated provider calls, every `UNREVIEWED` path with its reason, and concrete reductions when a limit would be exceeded. Estimates are always `best-effort`: primary lens demand is predictable, but model output determines how many skeptical verification calls are needed. AgentsKit rechecks the exact budget before every analysis, verification, and consolidation call. The runtime call counter remains the hard ceiling and fails closed if demand exceeds it. The preflight refuses before the provider starts when predictable primary demand exceeds either budget; `maxCalls` is capped at 1000 and unlimited mode is not supported. A required-lens failure is `INCOMPLETE` and exits `2`, including with `--no-fail`.

For a PR that exceeds one review budget, use deterministic coverage batches instead of accepting an incomplete review. Run `--plan --json --batch-size <n> --batch-manifest <private-file>` to create a private manifest keyed by repository, PR, head SHA, and policy fingerprint. Each `--batch-index <n> --result <private-file>` run is deliberately incomplete by itself and rejects `--post`; its result artifact carries the same identity plus its exact file manifest. `--consolidate-manifest <manifest> --artifacts <comma-list> --result <private-file>` rejects a missing, duplicate, stale, mismatched, failed, deadline-exceeded, or required-lens-incomplete artifact. Only that consolidated artifact is accepted by `--publish-result <file> --pr owner/repo#N --post`, which rechecks current SHA and policy before creating the one GitHub review. Delete or replace the private state when the PR SHA or policy changes; never upload it as a CI artifact or commit it.

Every `ReviewResult` (single run or consolidated batch) carries a `coverage: { totalFiles, reviewedFiles, unreviewedFiles }` denominator distinct from the `incomplete` boolean: `incomplete` folds every uncertainty (budget, deadline, unverified findings, missing lenses) into one flag, while `coverage` says how many of the eligible files this run actually reviewed — the Markdown reporter prints it as "N of M file(s) reviewed". For an in-progress batch run, `describeCoverage` (`src/batch-coverage.ts`) renders the same "N of M" line from a `BatchCoverageState` before every batch has landed, naming which batch indices are still pending.

When one changed text file is larger than the context budget, the planner recursively
partitions its projected source into deterministic line-range chunks before provider
execution. Each chunk keeps the original file and source-line identity, contributes to
complete coverage, and is independently budget-checked. A single line that still
exceeds the budget remains `UNREVIEWED`/blocked; the system never truncates it into a
false clean result.

## Cost and latency controls

One multidimensional analysis runs per bounded context pack; candidate findings then receive adversarial votes. The primary controls are:

- `--max-files`: positive hard file budget;
- `--max-calls`: bounded provider-call budget (absolute ceiling 1000);
- `--max-findings-per-file`: positive verified-finding budget per file;
- `--votes`: verification depth and cost;
- `--concurrency`: simultaneous model/subprocess calls (default 1 for CLI providers, 4 for API providers);
- `--profile fast`: one bounded correctness/security/tests batch per file, one vote, and no retry;
- `--deadline-ms`: hard global deadline; active local workers receive the abort signal and queued calls do not start;
- `--health-check`: bounded provider smoke check before analysis (`auto` or `off`);
- `review.context`: adjacent lines, related files, total model tokens, and reserved output tokens;
- `--paths` or workflow path filters: narrow scope;
- `--min-severity` and `--min-confidence`: output noise, not input-token cost.

Start advisory with a small file budget, measure provider usage, and raise depth only where it improves signal. Never present an unmeasured cost estimate as a guaranteed price.

Every completed report includes provider-call evidence: calls started, failed,
skipped by the circuit/budget, elapsed time, deadline status, circuit state, and
initial/final concurrency. Each review unit retries only normalized transient
timeout, rate-limit, server, or malformed-output failures with bounded
exponential backoff and jitter. Instability reduces live concurrency; sustained
success restores it only up to the provider capability limit. Authentication
and cancellation are never retried. Repeated exhausted transient failures open
the circuit, and cooldown permits one recovery probe. Completed sibling units
remain valid when another unit fails. Incomplete evidence is never an approval.

## SARIF

`--sarif out.sarif` writes SARIF 2.1.0 alongside Markdown. Each surviving finding includes a `code-review/<category>` rule, severity level, message, file, and line, plus a `partialFingerprints.primaryLocationLineHash` derived from the file, rule, and title only — deliberately excluding the line number, so GitHub Code Scanning still recognizes the same finding across runs even when an unrelated edit shifts it a few lines. `tool.driver` also reports the package `version` and an `informationUri`. Uploading SARIF to GitHub code scanning requires the separate `security-events: write` permission and `github/codeql-action/upload-sarif`; the bundled Action does not request that permission or upload automatically.

SARIF can contain source paths and model-generated explanations. Apply the same retention and access policy as CI logs.

### Route findings through reviewdog

[reviewdog](https://github.com/reviewdog/reviewdog) accepts SARIF directly, so no AgentsKit-specific reporter or converter is required. This complete pull-request job installs reviewdog, fetches the base history, generates the report in advisory mode, and lets reviewdog own diff filtering, annotations, and the final CI threshold:

```yaml
name: AgentsKit reviewdog
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0
      - uses: reviewdog/action-setup@d8edfce3dd5e1ec6978745e801f9c50b5ef80252 # v1.4.0
        with:
          reviewdog_version: v0.21.0
      - name: Review changed code
        env:
          BASE_REF: ${{ github.base_ref }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          REVIEWDOG_GITHUB_API_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          REPORT_FILE="$(mktemp)"
          trap 'rm -f "${REPORT_FILE}"' EXIT
          npx --yes github:AgentsKit-io/code-review#3dfd7427640148281454d52846d369e5ddf85b11 \
            --provider openai --model gpt-4o --base "origin/${BASE_REF}" \
            --sarif "${REPORT_FILE}" --no-fail &&
          reviewdog -f=sarif -name=agentskit-review \
            -reporter=github-pr-review -filter-mode=added -fail-level=error \
            < "${REPORT_FILE}"
```

The hosted-runner example uses an API provider because local CLI providers require their executable and an existing authenticated session. Replace the provider and model with your approved adapter. The base comes from the pull-request event rather than assuming `main`, and `fetch-depth: 0` makes its remote-tracking ref available to `git diff`. Pass the provider secret through `LLM_API_KEY`, pass the workflow token through `REVIEWDOG_GITHUB_API_TOKEN`, and grant only `contents: read` plus `pull-requests: write`.

The temporary report and `&&` prevent reviewdog from reading stale output when the producer fails. Keep `--no-fail` on the producer so reviewdog receives the complete report when review succeeds; `-fail-level=error` then makes SARIF `error` findings fail the reviewdog step. AgentsKit maps blocker and high findings to SARIF `error`, medium to `warning`, and nit to `note`.

The default `added` filter limits inline feedback to changed lines. Choose a broader reviewdog filter deliberately; broader modes can move findings outside the PR diff into checks, annotations, or console output depending on the reporter. Pin both Code Review and reviewdog to reviewed immutable versions in enforcement workflows.

## Failure scenarios

- **Unknown provider or missing model:** validate with `--list-providers`; API/local-server adapters require `--model`.
- **Authentication failure:** verify only the provider-specific secret/login and avoid printing its value. A terminal authentication failure stops remaining lenses immediately and the review exits incomplete rather than spending one failed call per lens.
- **Rate limit or timeout:** Codex calls stop after 300 seconds by default; other local CLI calls use 120 seconds. Set `AGENTSKIT_REVIEW_SUBPROCESS_TIMEOUT_MS` to a positive millisecond value when needed, reduce concurrency/file budget, or use an approved gateway; retry only when provider policy makes the operation safe.
- **No PR comments:** confirm `pull-requests: write`, token availability, and fork restrictions. The Markdown report still appears in logs.
- **Inline comment rejected:** the reporter falls back to a non-approving comment for GitHub 422 restrictions.
- **Large diff:** GitHub PR reviews cap metadata at 500 files, select only the configured file budget before downloading contents, and stop content downloads at the byte budget. Set `--max-files`/`--max-calls` or split review by paths; truncated or unreviewed files must not be described as reviewed.
- **Ollama timeout:** Requests stop after 30 seconds by default. Use a smaller scope or a responsive local model when the request is aborted; a stalled model must not hold the review indefinitely.
- **Provider unavailable:** fail or mark the check unavailable according to team policy; never silently convert it to approval.

## Releases and maturity

The current package is `0.4.0` and the project is pre-v1:

- GitHub-source CLI commands can pin a commit SHA after `github:AgentsKit-io/code-review#<sha>`;
- Actions should pin `@v0.4.0` or a full commit SHA;
- a moving `@main` reference is suitable only when that mutability is accepted;
- the future `@v1` Action tag remains a separate stability milestone.

Release work updates [`CHANGELOG.md`](../CHANGELOG.md), [`ROADMAP.md`](../ROADMAP.md), package version, immutable tag guidance, and signed/provenance evidence when available. Run `npm run check` and `npm pack --dry-run` before publishing.

### Automated npm publishing

Changesets is the release source of truth. A product-affecting pull request adds a small Markdown file in `.changeset/` that names `@agentskit/code-review`, selects `patch`, `minor`, or `major`, and explains the user-visible change. Documentation-only, test-only, and CI-only pull requests add `npx changeset --empty` when they intentionally require no release.

Every merge to `main` runs `.github/workflows/release.yml`. When pending non-empty changesets exist, it creates or updates the `chore: version packages` pull request on the trusted `changeset-release/main` branch. Native npm versioning synchronizes lockfile metadata without installing dependencies or creating a tag. The PR contains the version bump, generated `CHANGELOG.md` entry, and consumed changesets. After verifying bot authorship, same-repository branch and head SHA, the workflow uses GitHub's built-in token to authorize execution of that PR's CI, CodeQL and dependency-review workflows when GitHub holds them for approval. This authorizes tests, not PR approval or merge. It polls for the three matching workflow events for at most one minute and fails if they never arrive. No close/reopen, duplicate dispatch or personal token is needed. Successful required PR checks and the normal checked version-PR merge remain mandatory before publication.

`.github/workflows/publish.yml` runs only after that trusted version pull request is merged. It checks out that exact merge commit, verifies the package version and a clean release payload with `npm run check` and `npm pack --dry-run`, publishes `@agentskit/code-review` using [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC), then creates the immutable `v<version>` GitHub Release. If npm already has the exact version, it skips only the publish step and still creates a missing GitHub release; normal PR-triggered runs cannot publish a duplicate. No long-lived `NPM_TOKEN`, npm access token, or personal GitHub token is stored in this repository. GitHub's built-in workflow token is used only to create the version PR and GitHub release.

Enable [GitHub release immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes) in this repository before publishing. It applies only to future releases. The publish workflow verifies the release API's `immutable` value, including on retries, and fails rather than claiming an unprotected release is immutable. Never delete or replace an existing release to retrofit protection; publish the next reviewed version.

Before the first release, configure the npm package's Trusted Publisher for GitHub Actions with:

- Organization: `AgentsKit-io`
- Repository: `code-review`
- Workflow filename: `publish.yml`

Enable GitHub Actions permission to create pull requests only when the repository setting requires it for Changesets. Keep branch protection configured to require human review: the workflow never approves or merges its own version PR. This repository-wide setting can also permit workflow approvals, so restrict `pull-requests: write` to the version workflow and do not count workflow approvals toward the required human review. The npm configuration is a one-time external prerequisite; the GitHub workflow cannot create it. Do not run `npm publish` locally.

The publish workflow has no manual dispatch path: only a merged, title-matched Changesets version pull request from an explicitly allowlisted release branch can publish. If a release is interrupted, repair it through a new reviewed version PR rather than granting an arbitrary ref publishing authority.

## Contribution and security

Start with [`CONTRIBUTING.md`](../CONTRIBUTING.md). Provider integrations must preserve the AgentsKit adapter contract and keep secrets out of arguments/logs. Review lenses need reproducible evidence and false-positive fixtures. Report vulnerabilities privately through [`SECURITY.md`](../SECURITY.md).

For adjacent work, use [AgentsKit](https://www.agentskit.io/docs) for runtime and adapters, [Registry](https://registry.agentskit.io/docs) for the vendored agent, [AgentsKit Chat](https://chat.agentskit.io/docs) when review belongs inside a conversational application, [Playbook](https://playbook.agentskit.io/docs) for engineering patterns, [Doc Bridge](https://agentskit-io.github.io/doc-bridge/) for documentation ownership handoffs, and [AKOS](https://akos.agentskit.io/docs) for enterprise orchestration and production governance.

Machine readers should start with [`llms.txt`](../llms.txt), escalate to [`llms-full.txt`](../llms-full.txt) only when the complete corpus is required, and use [`docs/for-agents`](./for-agents/index.md) before changing an owned module.
