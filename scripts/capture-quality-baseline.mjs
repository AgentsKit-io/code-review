#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseQualityBaseline, qualityBaselineIdentity, validateStudyOutputPath } from '../dist/src/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1] }
const hashFiles = (...files) => createHash('sha256').update(files.map((file) => readFileSync(resolve(root, file))).join('\n')).digest('hex')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const libraryVersion = option('--library-version') ?? packageJson.version
const output = option('--output')

const benchmark = spawnSync(process.execPath, ['scripts/run-cycle-benchmark.mjs'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 60_000,
})
if (benchmark.status !== 0) throw new Error(benchmark.stderr.trim() || 'cycle benchmark failed')

const identity = {
  libraryVersion,
  sourceRevision: `v${libraryVersion}`,
  policyFingerprint: hashFiles('src/review-config.ts'),
  promptFingerprint: hashFiles('agents/code-review/agent.ts', 'agents/code-review/lenses.ts'),
  model: 'fixture/codex-cli',
}
const noTokens = { input: null, cachedInput: null, output: null, reasoning: null, memory: null, retry: null, total: null }
const source = JSON.parse(benchmark.stdout)
const baseline = parseQualityBaseline({
  schemaVersion: 2,
  baselineId: qualityBaselineIdentity(identity),
  identity,
  syntheticRuns: source.cases.map((item) => ({
    kind: 'synthetic-run',
    runId: item.id,
    fixtureId: `cycle/${item.id}`,
    outcome: item.artifact?.incomplete ? 'BLOCKED' : item.artifact?.verdict === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED',
    tokens: noTokens,
    duration: { wallClockMs: item.elapsedMs, preflightMs: null, providerMs: null, verificationMs: null, publishingMs: null, mergeMs: null },
    evidence: {
      origin: 'synthetic',
      fixtureId: `cycle/${item.id}`,
      fingerprint: createHash('sha256').update(JSON.stringify({ id: item.id, exitCode: item.exitCode, artifact: item.artifact })).digest('hex'),
    },
  })),
  realRuns: [],
  realCampaigns: [],
})
const json = `${JSON.stringify(baseline, null, 2)}\n`
if (output) writeFileSync(validateStudyOutputPath(output, root), json)
else process.stdout.write(json)
