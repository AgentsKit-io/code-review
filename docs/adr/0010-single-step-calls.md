# ADR-0010: Keep single-step structured calls; do not adopt an agent-loop context-compression scheme

Status: Accepted

## Context

`alibaba/open-code-review` runs its analysis as a multi-turn agent loop with read
tools (`file_read`, `code_search`, up to `MAX_TOOL_REQUEST_TIMES: 100` turns per
`internal/config/template/task_template.json`), and compresses the accumulating
transcript at two thresholds (0.60 async, 0.80 sync) to keep it inside the context
window across those many turns.

This library's every model call (`agents/code-review/agent.ts`, `runStructured`) is a
single step: `maxSteps` defaults to `1` (`createCodeReviewAgent`'s `config.maxSteps`),
the model receives exactly one prompt and is expected to answer with exactly one
`submit_*` tool call, validated by a Zod schema before anything downstream sees it.
There is no accumulating conversation transcript to compress, because there is no
conversation — each call is independent and bounded by `compileBudget` against the
context pack it was built for.

Two of this release's issues (#254 per-language rules, #255 semantic grouping) added
real cross-file and cross-language reasoning without needing a tool-calling loop: rules
are resolved deterministically by glob before the call is made, and semantic grouping
is its own single, separate structured call (`fileGrouping`/`FileGroupsSubmission`),
not a tool the main analysis call invokes mid-conversation.

## Decision

Do not adopt an agent-loop-with-read-tools architecture, and therefore do not adopt a
context-compression scheme built for one. The single-step, Zod-validated call remains
this library's core execution model for this release.

This is a decision to *not* build something, revisited only if a concrete need
appears that the current model cannot address:

- Detection/recall falls measurably below target on real reviews even after #254 and
  #255 are in active use, in a way traceable to the model needing information it
  cannot get from one bounded call plus deterministic pre-resolved context (rules,
  grouped files, related-file heuristics).
- A specific, recurring class of finding requires the model to decide *at review time*
  which additional file to read, rather than that file being determinable in advance
  by grouping or a rule glob.

If either holds, revisit this ADR with a proposal for a bounded (not open-ended)
tool-calling loop, and only then is transcript compression a candidate — it solves a
problem that does not exist until that loop exists.

## Consequences

Every call stays independently budgeted, replayable, and testable in isolation (as
every test added across #250–#259 in this release does): no hidden conversational
state, no compression policy to get wrong, no risk of `MAX_TOOL_REQUEST_TIMES`-style
runaway loops. The cost is real: a genuinely exploratory cross-file question the model
could answer by choosing to read one more file mid-analysis is instead only available
if #254's rules or #255's semantic grouping already anticipated the need. This library
already includes context expansion for that reason (`context.maxRelatedFiles`,
`context.grouping: 'semantic'`, per-language rules) rather than accepting the loop's
scope creep to compensate for narrower single-file context.
