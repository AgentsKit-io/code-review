## What changed

<!-- Describe the user-visible behavior. -->

## Why

<!-- Link the issue or explain the problem. -->

## How

<!-- Summarize the implementation and relevant design choices. -->

## Reuse

<!-- What existing package, module, library, or service did you consider or reuse? If none fit, why? -->

## Validation

- [ ] `npm run check`
- Acceptance criteria and their contract or edge-case tests:
- The repository's documented lint, test, build, typecheck, and other required gates pass on this commit:
- [ ] Public CLI or Action changes are documented
- [ ] No secrets or private model output are included
- [ ] Generated artifacts were regenerated with the official tools, when applicable

## Definition of Done

- [ ] One package, or one isolated cross-cutting gate change, per PR.
- [ ] Each acceptance criterion has a contract or edge-case test.
- [ ] The repository's documented gates pass on this commit.
- [ ] Measure size when a bundle or export changes; add or update JSDoc when a public API changes.
- [ ] Required changeset and documentation updates are included.
- [ ] No tests were disabled to pass checks.
- [ ] Generated artifacts were regenerated with the official tools, when applicable.
