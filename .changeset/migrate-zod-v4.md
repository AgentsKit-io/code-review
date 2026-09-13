---
"@agentskit/code-review": minor
---

Migrate from zod v3 to zod v4, and drop `zod-to-json-schema` in favor of zod v4's native `z.toJSONSchema()`. `zod-to-json-schema@3.25.2` declares zod v4 support in its peer dependencies, but its published types still import `zod/v3` internally — passing it a native v4 schema fails to typecheck, so bumping the library alone doesn't work; the dependency has to go.

This surfaced a real, pre-existing fragility during the migration: every structured tool-call schema in `agents/code-review/agent.ts` (`submit_batched_findings`, `submit_verdicts`, etc.) relied on `zod-to-json-schema`'s implicit default of `additionalProperties: false` for every `z.object()`, strict or not. `z.toJSONSchema()` only sets that when a schema is explicitly `.strict()`. Every one of those schemas is now `.strict()` by name, and a new test (`test/tool-schema-order.test.mjs`) locks `additionalProperties: false` in at every nesting level of the real tool-call schemas sent to providers, so this can't silently regress again.

Other consequences of the migration:

- `generateConfigSchema()` (the CLI's `--config-schema` output) keeps its `$schema: "http://json-schema.org/draft-07/schema#"` value via `z.toJSONSchema`'s `target: 'draft-7'` option, and keeps the `AgentsKitCodeReviewConfig` name via `.meta({ title })` instead of the old library's `name` option — the output is now a flat schema instead of a `$ref`-wrapped `definitions` entry, which is a JSON Schema shape change for anything that inspected that wrapper specifically (nothing in this repo did).
- `z.record(valueSchema)` calls became `z.record(z.string(), valueSchema)` (zod v4 requires an explicit key schema) across `campaign-store.ts`, `campaign-reducer.ts`, and `review-config.ts`.
- `.strict().default({})` on optional config sections in `public-config.ts` became `.strict().prefault({})` — zod v4's `.default()` now requires the already-resolved output shape as its argument, while `.prefault()` keeps the old "apply `{}` then let nested field defaults fill in" behavior.
- A custom `z.ZodError` issue was being re-added via `context.addIssue(issue)` in `campaign-runner.ts` with the full upstream issue object; zod v4's `addIssue` expects its own narrower shape, so this now rebuilds `{ code: 'custom', message, path }` explicitly.
- A CLI error-message check in `review-config.ts` matched zod v3's exact default message text for a `too_small` violation; zod v4 reworded that message, so the check now matches on the structured `issue.code`/`issue.minimum` instead of English text.

Full test suite (311 tests, one new) and the full local `check` gate pass.
