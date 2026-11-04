// Shared by scripts/shadow-review.mjs and scripts/line-review.mjs: run the built CLI once, the same way for both.
//   repository/number set: review that GitHub PR (needs GITHUB_TOKEN); otherwise the files changed in the checkout.
// Configuration comes from the environment only, under one prefix (AGENTSKIT_SHADOW / AGENTSKIT_LINE):
// <prefix>_PROVIDER, _MODEL, _MODE (isolated|trusted-local), _CONFIG (a code-review config file), _USD_PER_MTOK, _BASE (default origin/main).
import { runCommand, splitLines } from '@agentskit/cross-platform'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const isPrReference = (repository, number) => /^[\w.-]+\/[\w.-]+$/.test(repository ?? '') && /^\d+$/.test(number ?? '')

/**
 * Returns { files: 0 } when the checkout changed nothing reviewable, { failure } when the review could not run,
 * otherwise { code, review, costUsd, failure? } (failure set on a non-zero exit; review is the --result when written).
 */
export async function runReview({ repository, number, prefix, env = process.env, cwd = process.cwd() }) {
  const setting = (name) => env[`${prefix}_${name}`]
  const workdir = mkdtempSync(join(tmpdir(), 'agentskit-reviewer-run-'))
  try {
    const result = join(workdir, 'result.json')
    const args = [join(packageRoot, 'dist/src/cli.js'), '--result', result, '--no-fail', '--health-check', 'off']
    if (repository) args.push('--pr', `${repository}#${number}`)
    else {
      const diff = await runCommand('git', ['diff', '--name-only', '--diff-filter=AM', `${setting('BASE') ?? 'origin/main'}...HEAD`], { cwd, timeoutMs: 60_000 })
      if (diff.code !== 0) return { failure: `could not list the changed files (set ${prefix}_BASE)` }
      const files = splitLines(diff.stdout).filter(Boolean)
      if (!files.length) return { files: 0 }
      args.push('--paths', ...files)
    }
    if (setting('PROVIDER')) args.push('--provider', setting('PROVIDER'))
    if (setting('MODE')) args.push('--mode', setting('MODE'))
    if (setting('CONFIG')) args.push('--config', resolve(setting('CONFIG')))
    if (setting('MODEL')) args.push('--model', setting('MODEL'))
    const run = await runCommand(process.execPath, args, { cwd, timeoutMs: 1_800_000 })
    if (run.stderr) process.stderr.write(run.stderr)
    const review = existsSync(result) ? JSON.parse(readFileSync(result, 'utf8')) : undefined
    const costUsd = ((review?.evidence?.tokensUsed ?? 0) / 1e6) * Number(setting('USD_PER_MTOK') ?? 0)
    const failure = run.code === 0 ? undefined : `review failed (exit ${run.code ?? run.signal}): ${splitLines(run.stderr.trim()).at(-1) ?? ''}`.slice(0, 280)
    return { code: run.code, review, costUsd, ...(failure ? { failure } : {}) }
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}
