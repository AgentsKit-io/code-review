/**
 * Built-in per-language review checklists, resolved by glob against each file in a
 * context pack (see `src/review-rules.ts` for glob matching and layering with
 * project/global rule files). Kept as short, focused checklists rather than exhaustive
 * style guides — this text rides along in every prompt for a matching file, so it is
 * priced against the same token budget as the rest of the pack.
 *
 * A project or global `.agentskit-review/rules.json` entry for the same file takes
 * precedence (see `docs/OPERATIONS.md`); it is merged with the matching system rule
 * below unless the entry sets `mergeSystemRule: false`.
 *
 * Order matters: the first matching glob wins, so more specific patterns are listed
 * before `DEFAULT_RULE`'s catch-all `**`.
 */

export interface SystemRule {
  glob: string
  language: string
  rule: string
}

const TS_JS_RULE = `TypeScript/JavaScript checklist:
- No \`any\` at a public boundary; a widened type there defeats the type system for every caller.
- Promises: every rejection is awaited, caught, or explicitly and visibly ignored — never silently dropped.
- Async cleanup (listeners, timers, subscriptions, streams) has a matching teardown on every exit path, including thrown errors.
- Exported functions validate untrusted input (HTTP/IPC/CLI args/JSON.parse) before using it; a generated \`.d.ts\` or Zod type describes shape, not a runtime guarantee.
- Array/object mutation is intentional, not an accidental shared-reference side effect.`

const PYTHON_RULE = `Python checklist:
- Mutable default arguments (\`def f(x=[])\`) are avoided; a caller can observe stale state across calls.
- Exceptions are caught by the narrowest applicable type; a bare \`except:\` swallows real bugs and signals like KeyboardInterrupt.
- Resources (files, sockets, locks, DB connections) use \`with\`/context managers, not manual open/close on every path.
- Public functions type-hint and validate untrusted input; a type hint alone is not runtime enforcement.
- String formatting into a shell command, SQL query, or path never uses f-strings/\`%\`/\`.format\` on untrusted input.`

const GO_RULE = `Go checklist:
- Every returned \`error\` is checked or explicitly discarded with \`_\` and a comment saying why.
- A goroutine that can fail or block has a way to observe that (channel, errgroup, context cancellation) — it is not fired and forgotten.
- \`defer\` for cleanup (Close, Unlock) is registered immediately after the resource is acquired, not after intervening code that can return early.
- Exported functions do not panic on ordinary bad input; panics are reserved for programmer errors.
- Slices/maps received from a caller are not mutated unless the function's contract says so.`

const RUST_RULE = `Rust checklist:
- \`unwrap\`/\`expect\` on a \`Result\`/\`Option\` derived from external input (I/O, parsing, user data) is replaced with real error handling.
- \`unsafe\` blocks carry a comment justifying the invariant the compiler cannot check, and are as small as possible.
- A public API's error type is meaningful to the caller, not a stringly-typed catch-all.
- Ownership/borrowing changes (added \`clone()\`, \`Rc\`/\`RefCell\`) are deliberate, not a way to silence the borrow checker without understanding why.`

const JAVA_RULE = `Java/Kotlin checklist:
- Checked exceptions are handled or rethrown with context, never caught and silently swallowed (an empty catch block, or one that only logs and continues an invariant-breaking failure).
- Resources (streams, connections, locks) use try-with-resources / \`use\`, not manual close on every path.
- Public methods validate null/untrusted input at the boundary rather than deferring to a NullPointerException deep in the call stack.
- Mutable shared state accessed from more than one thread has a documented synchronization strategy, not an assumption of single-threaded use.`

const TERRAFORM_RULE = `Terraform/HCL checklist:
- A resource that can hold secrets or credentials does not have them in plain \`variable\` defaults or committed \`.tfvars\`.
- Destructive changes (replace, force-new) implied by an attribute edit are called out, not left implicit in the diff.
- \`for_each\`/\`count\` keys are stable identifiers, not list indices that reorder or destroy resources on an unrelated list change.
- IAM/security-group rules are scoped to what the resource actually needs, not a wildcard broadened for convenience.`

const GITHUB_WORKFLOWS_RULE = `GitHub Actions checklist:
- \`pull_request_target\` or a workflow with repo secrets never checks out and executes untrusted PR-branch code.
- A third-party action is pinned to a full commit SHA, not a mutable tag, when it can access secrets or write access.
- Secrets are not echoed into logs, passed as plain command-line arguments, or interpolated unsanitized into a \`run:\` shell command from untrusted context (PR title, branch name, issue body).
- \`permissions:\` is scoped to what the job needs, not left at the broad default.`

const YAML_RULE = `YAML/config checklist:
- No secret, API key, or credential is present in plain text, even in a comment or an example marked "for local dev only".
- Anchors/aliases and merge keys produce the value the author intended, not an unnoticed override.
- A config change that alters production behavior (feature flags, resource limits, replica counts) is intentional, not an accidental value carried over from a copy-paste.`

const JSON_RULE = `JSON checklist:
- A committed JSON file is not a build artifact or generated lockfile edited by hand (check for a corresponding generator).
- Schema/contract JSON (OpenAPI, JSON Schema) changes are backward compatible unless the change is clearly versioned as breaking.`

const DEFAULT_RULE = `General checklist:
- The change does what its description/commit message claims, on the lines actually touched.
- Error paths are handled, not just the happy path.
- Nothing in the diff looks like a secret, credential, or internal URL that should not be committed.`

export const SYSTEM_RULES: readonly SystemRule[] = [
  { glob: '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', language: 'ts-js', rule: TS_JS_RULE },
  { glob: '**/*.py', language: 'python', rule: PYTHON_RULE },
  { glob: '**/*.go', language: 'go', rule: GO_RULE },
  { glob: '**/*.rs', language: 'rust', rule: RUST_RULE },
  { glob: '**/*.{java,kt,kts}', language: 'java', rule: JAVA_RULE },
  { glob: '**/*.{tf,tfvars,hcl}', language: 'terraform', rule: TERRAFORM_RULE },
  { glob: '.github/workflows/*.{yml,yaml}', language: 'github-workflows', rule: GITHUB_WORKFLOWS_RULE },
  { glob: '**/*.{yml,yaml}', language: 'yaml', rule: YAML_RULE },
  { glob: '**/*.json', language: 'json', rule: JSON_RULE },
  { glob: '**', language: 'default', rule: DEFAULT_RULE },
]
