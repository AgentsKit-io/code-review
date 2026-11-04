#!/usr/bin/env node
// Runs the incumbent line reviewer and code-review over quality/benchmark/prs.json and applies the entry criterion.
//   node scripts/run-reviewer-benchmark.mjs --incumbent-cmd <executable> [--provider <p> --model <m> --usd-per-mtok <n>]
//     [--candidate-cmd <executable>] [--candidate-version <x.y.z>] [--concurrency <n>] [--stage-timeout-ms <n>] [--dataset <file>]
//     [--output <report.json>] [--markdown <report.md>]
// A reviewer command is run as `<executable> <owner/repo> <number> <commit>` (no shell; <commit> is the pinned head
// of the PR in the set, the same for both reviewers) and must print
// {"findings":[{"file","line","title"}],"costUsd":0} on stdout. Without --candidate-cmd the built-in CLI is used.
// Before and after reviewing a PR the runner reads its head from GitHub (GITHUB_TOKEN; AGENTSKIT_BENCHMARK_GITHUB_API
// overrides https://api.github.com) and records an error for both reviewers if it is not the pinned commit.
// The report records the measured candidate version (this package's version unless --candidate-version) and the
// dataset's sha256, which scripts/check-version-pin.mjs requires before the line may pin that version.
// Credentials are inherited from the environment; none are accepted as arguments.
import { isPathInside, relativePosix, runCommand, toPosix } from '@agentskit/cross-platform'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeFailure, evaluateBenchmark, parseBenchmarkDataset, pinnedCommitError, renderBenchmarkMarkdown } from '../dist/src/reviewer-benchmark.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function headOf(pr) {
  const api = (process.env.AGENTSKIT_BENCHMARK_GITHUB_API ?? 'https://api.github.com').replace(/\/$/, '')
  const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }
  try {
    const response = await fetch(`${api}/repos/${pr.repository}/pulls/${pr.number}`, { headers })
    return response.ok ? (await response.json())?.head?.sha : undefined
  } catch {
    return undefined
  }
}

const unpinned = (message) => ({ findings: [], costUsd: 0, latencyMs: 0, error: message.slice(0, 300), errorDetail: describeFailure('pin-check', undefined, message) })

async function runExternal(command, pr) {
  const startedAt = Date.now()
  const run = await runCommand(command, [pr.repository, String(pr.number), pr.commit], { timeoutMs: 1_800_000 })
  const latencyMs = Date.now() - startedAt
  if (run.code !== 0) {
    const detail = describeFailure('review', run.code ?? run.signal, run.stderr)
    return { findings: [], costUsd: 0, latencyMs, error: `exit ${detail.exitCode}: ${detail.stderrTail.at(-1) ?? ''}`.slice(0, 300), errorDetail: detail }
  }
  try {
    const out = JSON.parse(run.stdout)
    return { findings: out.findings ?? [], costUsd: Number(out.costUsd ?? 0), latencyMs }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { findings: [], costUsd: 0, latencyMs, error: message, errorDetail: describeFailure('parse-output', run.code, `${message}\n${run.stderr}`) }
  }
}

async function runBuiltIn(pr, workdir) {
  const provider = value('provider')
  const usdPerMtok = Number(value('usd-per-mtok') ?? 0)
  const result = join(workdir, `${pr.id.replace(/[^\w.-]/g, '_')}.json`)
  const args = ['dist/src/cli.js', '--pr', `${pr.repository}#${pr.number}`, '--result', result, '--no-fail']
  if (provider) args.push('--provider', provider)
  if (value('model')) args.push('--model', value('model'))
  const startedAt = Date.now()
  const run = await runCommand(process.execPath, args, { cwd: root, timeoutMs: 1_800_000 })
  const latencyMs = Date.now() - startedAt
  if (run.code !== 0) {
    const detail = describeFailure('review', run.code ?? run.signal, run.stderr)
    return { findings: [], costUsd: 0, latencyMs, error: `exit ${detail.exitCode}: ${detail.stderrTail.at(-1) ?? ''}`.slice(0, 300), errorDetail: detail }
  }
  try {
    const review = JSON.parse(readFileSync(result, 'utf8'))
    return { findings: review.findings.map((f) => ({ file: f.file, line: f.line, title: f.title })), costUsd: ((review.evidence?.tokensUsed ?? 0) / 1e6) * usdPerMtok, latencyMs }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { findings: [], costUsd: 0, latencyMs, error: message, errorDetail: describeFailure('parse-output', run.code, `${message}\n${run.stderr}`) }
  }
}

const incumbentCmd = value('incumbent-cmd')
if (!incumbentCmd) {
  process.stderr.write('--incumbent-cmd <executable> is required\n')
  process.exit(64)
}
const datasetFile = resolve(value('dataset') ?? join(root, 'quality/benchmark/prs.json'))
const datasetText = readFileSync(datasetFile, 'utf8')
const dataset = parseBenchmarkDataset(JSON.parse(datasetText))
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const meta = {
  candidateVersion: value('candidate-version') ?? packageVersion,
  datasetSha256: createHash('sha256').update(datasetText).digest('hex'),
}
const setPath = isPathInside(root, datasetFile) ? relativePosix(root, datasetFile) : toPosix(datasetFile)
const candidateCmd = value('candidate-cmd')
const workdir = mkdtempSync(join(tmpdir(), 'agentskit-reviewer-benchmark-'))
try {
  const incumbentRuns = {}
  const candidateRuns = {}
  const queue = [...dataset.prs]
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) {
      const before = pinnedCommitError(pr, await headOf(pr))
      if (before) {
        incumbentRuns[pr.id] = unpinned(before)
        candidateRuns[pr.id] = unpinned(before)
        continue
      }
      incumbentRuns[pr.id] = await runExternal(incumbentCmd, pr)
      candidateRuns[pr.id] = candidateCmd ? await runExternal(candidateCmd, pr) : await runBuiltIn(pr, workdir)
      const after = pinnedCommitError(pr, await headOf(pr))
      if (after) {
        incumbentRuns[pr.id] = unpinned(`head moved during the run: ${after}`)
        candidateRuns[pr.id] = unpinned(`head moved during the run: ${after}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Number(value('concurrency') ?? 1)) }, worker))
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const git = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10_000 }).catch(() => undefined)
  const gitCommit = git?.code === 0 ? git.stdout.trim() : undefined
  const report = evaluateBenchmark(dataset, incumbentRuns, candidateRuns, { ...meta, ...(value('stage-timeout-ms') ? { stageTimeoutMs: Number(value('stage-timeout-ms')) } : {}), setPath, run: { codeReviewVersion: meta.candidateVersion, ...(gitCommit ? { gitCommit } : {}) } })
  if (value('output')) writeFileSync(resolve(value('output')), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  const markdown = renderBenchmarkMarkdown(report)
  if (value('markdown')) writeFileSync(resolve(value('markdown')), markdown)
  process.stdout.write(markdown)
  if (report.decision !== 'PASS') process.exitCode = 2
} finally {
  rmSync(workdir, { recursive: true, force: true })
}
