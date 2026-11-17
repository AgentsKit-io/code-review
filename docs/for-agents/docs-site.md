---

type: package
package: docs-site
title: Docs site agent handoff
description: Ownership, change routes, checks, and boundaries for the Fumadocs site in apps/docs.
editRoot: apps/docs
checks: [npm run docs:web:typecheck, npm run docs:web:build]
---

# Docs site agent handoff

## Purpose

`apps/docs` is the Fumadocs presentation surface for https://code-review.agentskit.io. It renders the curated guides from `docs/` and must never run real reviews or hold provider keys.

## Change routes

- Content lives in `docs/`; edit pages there, not in generated `apps/docs/.source`.
- App code, layout, and routes live in `apps/docs/`; it has its own `package-lock.json` (`npm install --prefix apps/docs`).
- Read `apps/docs/AGENTS.md` for the framework version rules before editing app code.

## Verification

```bash
npm run docs:web:typecheck
npm run docs:web:build
```
