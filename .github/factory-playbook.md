# Factory playbook — AgentsKit-io/code-review

Public repo: only synthetic data, never anything from private repos (see AGENTS.md).
Read `AGENTS.md` and `docs/for-agents/code-review.md` before editing.

## 1. Install
- Node 22 (CI uses 22; local 20+ works, `test:coverage` needs >= 22.8). npm only (`package-lock.json`), no pnpm.
- `npm ci && npm ci --prefix apps/docs` (same as CI; the docs app has its own lockfile).
- Stale lockfile: `npm install` (and `npm install --prefix apps/docs`), commit the lockfile with the change. Never hand-edit it.
- Env vars: none needed; tests are offline. Provider keys (e.g. `OPENAI_API_KEY`) must never appear in files or logs.

## 2. Run locally
- CLI, no server/port/seed: `npm run review -- --help` (tsx) or `npm run build && node dist/src/cli.js --help`.
- Docs site (optional): `npm run docs:web:dev`.

## 3. Quick verification (small diff)
- `npm run typecheck`
- `npm run build && node --test --test-concurrency=1 test/<file>.test.mjs` (tests run against `dist/`, so build first; one test: add `--test-name-pattern "<name>"`).
- Touched docs/`package.json` files/benchmark data: also `node --test test/documentation.test.mjs`.
- There is no separate lint/format script; `typecheck` + `check` are the gate.

## 4. Full verification (CI, `.github/workflows/`)
- `ci.yml` job `check` (the one that matters), in order: `touch .doc-bridge/.ci-content-revision`; `npm run docs:index`; `git diff --exit-code -- doc-bridge.config.json .doc-bridge llms-full.txt`; `npm run check:public-api`; `npm run check`; `npm run test:coverage`; `npm pack --dry-run`; then `rm -f .doc-bridge/.ci-content-revision`.
- `npm run check` = cross-platform check, typecheck, build+tests, docs gate, docs web typecheck, public API, CLI `--help`, readme standard. Slowest job: `check` (full test suite is serial, `--test-concurrency=1`).
- `codeql.yml` (reusable workflow, `security-and-quality`), `dependency-review.yml` (review, audit, docs-audit; fails on high severity), `scorecard.yml`, `publish.yml`/`release.yml` (release only). CodeQL often finishes last: a PR can sit with `CodeQL` pending while `check` is green, or fail on a new alert; fix the alert, do not rerun blindly.
- Before finishing run (wrap like CI so the index is CI-mode; the sentinel is never committed): `touch .doc-bridge/.ci-content-revision && npm run docs:index && npm run check && npm run test:coverage && npm pack --dry-run; rm -f .doc-bridge/.ci-content-revision`, then `git status` must show only intended files (docs:index regenerates tracked files; commit them).

## 5. Rules that most often sink a PR
- Conventional commit messages (`feat:`, `fix:`, `docs:`...); one concern per PR.
- Release notes: add ONE `changelog.d/<ticket>.md` (first line a conventional line, e.g. `feat: ... (#N)`). Do not bump `package.json` version or edit the top of `CHANGELOG.md`. A `.changeset/<slug>.md` (`"@agentskit/code-review": patch` + one line) is also used by recent PRs; follow the latest merged PR.
- Generated docs: after changing docs, CLI help or `.doc-bridge` inputs run `npm run docs:index` (also regenerates `llms-full.txt`); CI fails on any diff in `doc-bridge.config.json .doc-bridge llms-full.txt`.
- Public exports changed: `npm run check:public-api:update`, review the snapshot `docs/stability/public-api-v1.json`, commit it.
- Coverage floors: 93% lines, 79% branches, 92% functions on `dist/src`; new `src/` code needs tests.
- Public CLI/Action contract changes need docs plus offline tests. Keep the Action advisory by default.
- `package.json` `files` is an allowlist for the npm tarball: every new script, doc, fixture, test or data file that the package/tests use must be added there (`npm pack --dry-run` to confirm).
- PR body: follow `.github/PULL_REQUEST_TEMPLATE.md`; no secrets or model output.

## 6. Shared registry files (merge-conflict hotspots)
- `package.json` `files` array: add your entries at the END of the array (never reorder), one per line, so parallel PRs only conflict at the tail; resolve by keeping both sides.
- `CHANGELOG.md`, `package.json` version: do not touch (use `changelog.d/<ticket>.md`, a unique filename per ticket).
- Generated, never hand-merge: `.doc-bridge/*`, `llms-full.txt`, `doc-bridge.config.json`, `docs/stability/public-api-v1.json`. On conflict: merge main, then regenerate with `npm run docs:index` / `check:public-api:update`.
- `quality/benchmark/prs.json`, `prices.json`, `report.json`: edit only the entries you own; regenerate `report.json` with its script, not by hand.
- Before finishing: `git merge origin/main` (never rebase), rerun the verification.

## 7. Known pitfalls (real factory failures here)
- "branch factory/... is not on AgentsKit-io/code-review" (inspect, 2x): the branch was never pushed or was deleted. The factory line pushes; commit everything on the current branch, do not switch or rename branches, do not rewrite history.
- "CI red: CodeQL; pending: check": CodeQL is a separate required job. Avoid patterns it flags (unsanitized paths/regex from input, shell injection in scripts, logging secrets); run `npm run check` AND `npm run test:coverage` since `check` pending means the slow suite was still running.
- Reviewer: new data file missing from `files`: the `quality/benchmark/prices.json` case. Add every new shipped/tested file to `package.json` `files` next to its siblings (e.g. beside `quality/benchmark/prs.json`) and add a test that every such path is listed in `files`.
- Reviewer: PR body `Closes N` vs `Refs N`: RF-N tickets stay open until a benchmark report is PASS for an npm-published version. Use `Refs #N` for them, `Closes #N` only when the ticket asks to be closed by the merge.
- "Pull Request has merge conflicts" (deliver): other PRs touched the same registries (section 6). `git merge origin/main`, regenerate generated files, rerun verification before finishing; never rebase.
