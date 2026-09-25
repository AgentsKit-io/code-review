# AGENTS.md — AgentsKit Code Review

Read [`docs/for-agents/code-review.md`](docs/for-agents/code-review.md) before editing. It owns the module map, public boundaries, change routes, and verification commands.

## Non-negotiable boundaries

- Keep provider behavior behind the AgentsKit adapter contract.
- Keep the GitHub Action advisory by default; blocking is explicit policy.
- Never place API keys in arguments, fixtures, logs, documentation examples, or review output.
- Keep review execution and provider behavior in the CLI/Action. The Fumadocs site is a presentation and documentation surface; it must not run real reviews.
- Update public docs and offline tests with any CLI, provider, reporter, or Action contract change.

## Verification

Run both commands before shipping:

```bash
npm run check
npm pack --dry-run
```
