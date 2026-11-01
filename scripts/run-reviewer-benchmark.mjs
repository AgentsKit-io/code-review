#!/usr/bin/env node
// Runs the incumbent line reviewer and code-review over quality/benchmark/prs.json and applies the entry criterion.
//   node scripts/run-reviewer-benchmark.mjs --incumbent-cmd <executable> [--provider <p> --model <m> --usd-per-mtok <n>]
//     [--candidate-cmd <executable>] [--candidate-version <x.y.z>] [--concurrency <n>] [--dataset <file>] [--output <report.json>] [--markdown <report.md>]
// A reviewer command is run as `<executable> <owner/repo> <number>` (no shell) and must print
// {"findings":[{"file","line","title"}],"costUsd":0} on stdout. Without --candidate-cmd the built-in CLI is used.
// The report records the measured candidate version (this package's version unless --candidate-version) and the
// dataset's sha256, which scripts/check-version-pin.mjs requires before the line may pin that version.
// Credentials are inherited from the environment; none are accepted as arguments.
import { runCommand, splitLines } from '@agentskit/cross-platform'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateBenchmark, parseBenchmarkDataset, renderBenchmarkMarkdown } from '../dist/src/reviewer-benchmark.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function runExternal(command, pr) {
  const startedAt = Date.now()
  const run = await runCommand(command, [pr.repository, String(pr.number)], { timeoutMs: 1_800_000 })
  const latencyMs = Date.now() - startedAt
  try {
    if (run.code !== 0) throw new Error(`exit ${run.code ?? run.signal}: ${splitLines(run.stderr.trim()).at(-1) ?? ''}`.slice(0, 300))
    const out = JSON.parse(run.stdout)
    return { findings: out.findings ?? [], costUsd: Number(out.costUsd ?? 0), latencyMs }
  } catch (error) {
    return { findings: [], costUsd: 0, latencyMs, error: error instanceof Error ? error.message : String(error) }
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
  try {
    if (run.code !== 0) throw new Error(`exit ${run.code ?? run.signal}`)
    const review = JSON.parse(readFileSync(result, 'utf8'))
    return { findings: review.findings.map((f) => ({ file: f.file, line: f.line, title: f.title })), costUsd: ((review.evidence?.tokensUsed ?? 0) / 1e6) * usdPerMtok, latencyMs }
  } catch (error) {
    return { findings: [], costUsd: 0, latencyMs, error: error instanceof Error ? error.message : String(error) }
  }
}

const incumbentCmd = value('incumbent-cmd')
if (!incumbentCmd) {
  process.stderr.write('--incumbent-cmd <executable> is required\n')
  process.exit(64)
}
const datasetText = readFileSync(resolve(value('dataset') ?? join(root, 'quality/benchmark/prs.json')), 'utf8')
const dataset = parseBenchmarkDataset(JSON.parse(datasetText))
const meta = {
  candidateVersion: value('candidate-version') ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  datasetSha256: createHash('sha256').update(datasetText).digest('hex'),
}
const candidateCmd = value('candidate-cmd')
const workdir = mkdtempSync(join(tmpdir(), 'agentskit-reviewer-benchmark-'))
try {
  const incumbentRuns = {}
  const candidateRuns = {}
  const queue = [...dataset.prs]
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) {
      incumbentRuns[pr.id] = await runExternal(incumbentCmd, pr)
      candidateRuns[pr.id] = candidateCmd ? await runExternal(candidateCmd, pr) : await runBuiltIn(pr, workdir)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Number(value('concurrency') ?? 1)) }, worker))
  const report = evaluateBenchmark(dataset, incumbentRuns, candidateRuns, meta)
  if (value('output')) writeFileSync(resolve(value('output')), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  const markdown = renderBenchmarkMarkdown(report)
  if (value('markdown')) writeFileSync(resolve(value('markdown')), markdown)
  process.stdout.write(markdown)
  if (report.decision !== 'PASS') process.exitCode = 2
} finally {
  rmSync(workdir, { recursive: true, force: true })
}
