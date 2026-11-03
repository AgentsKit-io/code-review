#!/usr/bin/env node
// Reviewer wrapper for the factory line's shadow mode and for scripts/run-reviewer-benchmark.mjs.
//   shadow-review.mjs                      review the changed files of the checkout in the working directory
//   shadow-review.mjs <owner/repo> <n>     review that GitHub PR (needs GITHUB_TOKEN)
// The LAST line of stdout is {"comment","costUsd","findings":[{file,line,title}]}; progress goes to stderr and the
// exit code is 0 for a completed review, even with findings (it comments, it does not decide).
// Configuration comes from the environment only: AGENTSKIT_SHADOW_PROVIDER, AGENTSKIT_SHADOW_MODEL, AGENTSKIT_SHADOW_MODE (isolated|trusted-local),
// AGENTSKIT_SHADOW_CONFIG (a code-review config file, e.g. for a larger budget), AGENTSKIT_SHADOW_USD_PER_MTOK (cost = tokens x rate; 0 when unset), AGENTSKIT_SHADOW_BASE (default origin/main).
import { renderMarkdown } from '../dist/agents/code-review/reporters.js'
import { isPrReference, runReview } from './reviewer-run.mjs'

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
const fail = (message) => { process.stderr.write(`shadow-review: ${message}\n`); process.exit(2) }

const [repository, number] = process.argv.slice(2)
if (repository && !isPrReference(repository, number)) fail('usage: shadow-review.mjs [<owner/repo> <number>]')
const run = await runReview({ repository, number, prefix: 'AGENTSKIT_SHADOW' })
if (run.files === 0) { emit({ comment: '## Code review\n\nNo changed files to review.', costUsd: 0, findings: [] }); process.exit(0) }
if (run.failure) fail(run.failure)
emit({
  comment: renderMarkdown(run.review),
  costUsd: run.costUsd,
  findings: run.review.findings.map((f) => ({ file: f.file, line: f.line, title: f.title })),
})
