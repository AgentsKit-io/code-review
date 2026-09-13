# ADR-0009: Layered, glob-resolved per-language review rules, opt-in and library-level

Status: Accepted

## Context

Before this release, the only way to steer review behavior per project was a single
free-text `conventions` file or string, injected unconditionally and identically for
every file in a review, truncated at a fixed 6000 characters with no distinction by
language or path. `alibaba/open-code-review` instead resolves a checklist per file by
glob, layered by precedence (custom → project → global → system), with ~55 built-in
per-language checklists.

## Decision

Add `agents/code-review/rules.ts` (`SYSTEM_RULES`: a small, ordered list of built-in
per-language checklists as TypeScript string constants — matching this repo's existing
style of inline prompt text in `lenses.ts`, not separate `.md` assets this repo's build
has no step to package) and `src/review-rules.ts` (`matchGlob`, `loadRuleLayers`,
`resolveRuleForFile`, `resolveRulesForFiles`), resolved with project layer
(`.agentskit-review/rules.json`) beating global layer (`~/.agentskit-review/rules.json`)
beating the system checklist, merged unless a layer entry sets
`mergeSystemRule: false`.

Two deliberate constraints, both distinct from `open-code-review`'s equivalent:

- **No new dependency for glob matching.** `matchGlob` is a ~35-line hand-written
  matcher (`**`, `*`, `?`, `{a,b,c}` alternation) rather than `micromatch`/`picomatch`
  (present in this package's dependency tree only transitively, not as a direct
  dependency it has ever declared). This package deliberately keeps a small,
  enumerable direct-dependency list; a full glob library is more surface than ten
  built-in globs and a caller's own rule file need.
- **Off by default** (`rules.enabled` defaults to `false`). Resolving and injecting a
  per-language checklist changes prompt content — and so cost — for every file in every
  review. A feature that changes an existing caller's prompt/cost profile must not turn
  on silently on a patch upgrade; it is opt-in, the same posture this release also took
  for `verification.posture` (ADR-0008) and telemetry (`createTelemetryObserver`).

## Consequences

A caller gets `open-code-review`'s per-language-checklist idea without a new
dependency and without an unannounced behavior change for existing callers who never
asked for it. The built-in set (ts-js, python, go, rust, java/kotlin, terraform,
github-workflows, yaml, json, and a general default) covers this repository's own
primary language mix, not the ~55 checklists `open-code-review` ships; adding more is
purely additive (append a glob-to-checklist entry to `SYSTEM_RULES`) and needs no
further architectural decision. There is, as yet, no `.agentskit-review.json` project
config surface or CLI flag for any of `rules.*` — it is a `createCodeReviewAgent`
option today, consistent with several sibling options in this same release
(`verification.posture`, `context.grouping`) that also have no project-config surface
of their own.
