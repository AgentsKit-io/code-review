#!/usr/bin/env node
// Reviewer wrapper for the factory line's shadow mode and for scripts/run-reviewer-benchmark.mjs.
//   shadow-review.mjs                      review the changed files of the checkout in the working directory
//   shadow-review.mjs <owner/repo> <n>     review that GitHub PR (needs GITHUB_TOKEN)
// The LAST line of stdout is {"comment","costUsd","findings":[{file,line,title}]}; progress goes to stderr and the
// exit code is 0 for a completed review, even with findings (it comments, it does not decide).
// Configuration comes from the environment only: AGENTSKIT_SHADOW_PROVIDER, AGENTSKIT_SHADOW_MODEL,
// AGENTSKIT_SHADOW_USD_PER_MTOK (cost = tokens x rate; 0 when unset), AGENTSKIT_SHADOW_BASE (default origin/main).
import { runCommand } from '@agentskit/cross-platform'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMarkdown } from '../dist/agents/code-review/reporters.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env
const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
const fail = (message) => { process.stderr.write(`shadow-review: ${message}\n`); process.exit(2) }

const [repository, number] = process.argv.slice(2)
const workdir = mkdtempSync(join(tmpdir(), 'agentskit-shadow-review-'))
try {
  const result = join(workdir, 'result.json')
  const args = [join(root, 'dist/src/cli.js'), '--result', result, '--no-fail', '--health-check', 'off']
  if (repository) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(number ?? '')) fail('usage: shadow-review.mjs [<owner/repo> <number>]')
    args.push('--pr', `${repository}#${number}`)
  } else {
    const diff = await runCommand('git', ['diff', '--name-only', '--diff-filter=AM', `${env.AGENTSKIT_SHADOW_BASE ?? 'origin/main'}...HEAD`], { cwd: process.cwd(), timeoutMs: 60_000 })
    if (diff.code !== 0) fail('could not list the changed files (set AGENTSKIT_SHADOW_BASE)')
    const files = diff.stdout.split('\n').filter(Boolean)
    if (!files.length) { emit({ comment: '## Code review\n\nNo changed files to review.', costUsd: 0, findings: [] }); process.exit(0) }
    args.push('--paths', ...files)
  }
  if (env.AGENTSKIT_SHADOW_PROVIDER) args.push('--provider', env.AGENTSKIT_SHADOW_PROVIDER)
  if (env.AGENTSKIT_SHADOW_MODEL) args.push('--model', env.AGENTSKIT_SHADOW_MODEL)
  const run = await runCommand(process.execPath, args, { cwd: process.cwd(), timeoutMs: 1_800_000 })
  if (run.stderr) process.stderr.write(run.stderr)
  if (run.code !== 0) fail(`review failed (exit ${run.code ?? run.signal})`)
  const review = JSON.parse(readFileSync(result, 'utf8'))
  emit({
    comment: renderMarkdown(review),
    costUsd: ((review.evidence?.tokensUsed ?? 0) / 1e6) * Number(env.AGENTSKIT_SHADOW_USD_PER_MTOK ?? 0),
    findings: review.findings.map((f) => ({ file: f.file, line: f.line, title: f.title })),
  })
} finally {
  rmSync(workdir, { recursive: true, force: true })
}
