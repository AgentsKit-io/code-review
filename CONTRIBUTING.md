# Contributing

Thanks for helping make AI code review more useful and less noisy.

## Start here

1. Fork and clone the repository.
2. Create a focused branch from `main`.
3. Run `npm install`.
4. Make the smallest change that solves the issue.
5. Run `npm run check` before opening a pull request.

Node.js 20 or newer is required; `npm run test:coverage` requires Node.js 22.8 or newer.

## Public API snapshot

The package's exported names and symbol kinds are recorded per export subpath in
`docs/stability/public-api-v1.json`. `npm run check:public-api` compares the
current TypeScript API with that snapshot and reports additions, removals, and
kind changes. When an API change is intentional, run
`npm run check:public-api:update`, review the snapshot diff, and commit the
updated snapshot with the API change.

`npm run test:coverage` runs the offline test suite with Node's built-in coverage
reporter, covering `dist/src` only. The baseline floors are 93% lines, 79% branches,
and 92% functions; raise a floor after tests improve its corresponding metric.

## Project map

- `src/cli.ts` — arguments, providers, review policy, and reporters.
- `src/*-adapter.ts` — adapters for logged-in local CLIs.
- `agents/code-review/` — vendored review agent, lenses, sources, and reporters.
- `action.yml` — GitHub Action interface.
- `examples/` — copy-ready workflows.

## Good contributions

- Reduce a reproducible false positive.
- Add a provider through the existing adapter contract.
- Add a focused review lens with clear evidence requirements.
- Improve a reporter or source without tying it to one model.
- Add provider-neutral examples and documentation.

Please open an issue before a large architectural change. Small fixes and documentation improvements can go straight to a pull request.

## Pull requests

- Keep one concern per PR.
- Explain the user-visible behavior and how you tested it.
- Add or update tests for behavior changes.
- Preserve provider neutrality: provider-specific behavior belongs in its adapter.
- Never commit API keys, model output containing private code, or review tokens.
- Update README or examples when changing the public CLI or Action interface.

Project decisions, maintainer responsibilities, and the release process are
documented in [GOVERNANCE.md](GOVERNANCE.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
