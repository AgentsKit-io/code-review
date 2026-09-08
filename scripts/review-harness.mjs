#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHarnessRun, recordBatchCompletion, recordCanaryAttempt, validateCanary, runBlockerSweep } from '../dist/src/harness.js'

const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const json = (file, label) => {
  if (!file) throw new Error(`missing --${label}`)
  return JSON.parse(readFileSync(file, 'utf8'))
}
const checksFile = value('checks')
const manifestFile = value('manifest')
const artifactFile = value('artifact')
const replay = process.argv.includes('--replay')
const stateFile = value('state')
const initRun = value('init-run')
const completeBatch = value('complete-batch')
const canaryStatus = value('canary-status')
const preflight = process.argv.includes('--preflight')
const writeState = (state) => {
  if (!stateFile) throw new Error('missing --state')
  const temp = `${stateFile}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, stateFile)
}
if (preflight) {
  const checks = []
  const add = (id, ok, detail, remediation) => checks.push({ id, ok, detail, remediation })
  const configFile = value('config')
  const pr = value('pr')
  const provider = value('provider') ?? 'codex-cli'
  const stateDir = value('state-dir')
  const expectedVersion = value('expected-version')
  add('config.exists', Boolean(configFile && existsSync(configFile)), configFile ? `configuration path: ${configFile}` : 'configuration path was not provided', 'provide the validated project configuration path')
  add('github.token', Boolean(process.env.GITHUB_TOKEN), 'GITHUB_TOKEN is available to the child process', 'authenticate GitHub before live review')
  add('pr.identity', Boolean(pr && /^[^/]+\/[^#]+#\d+$/.test(pr)), pr ?? 'PR identity was not provided', 'use --pr owner/repository#number')
  add('provider.binary', provider !== 'codex-cli' || spawnSync('command', ['-v', 'codex'], { shell: true, encoding: 'utf8' }).status === 0, provider === 'codex-cli' ? 'codex executable is available' : `provider ${provider} is validated by the configured adapter`, 'install or authenticate the selected provider')
  if (stateDir) {
    const probe = `${stateDir}/.harness-write-probe-${process.pid}`
    try { writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 }); unlinkSync(probe); add('state.writable', true, `state directory is writable: ${stateDir}`) }
    catch { add('state.writable', false, `state directory is not writable: ${stateDir}`, 'use a writable run-local state directory') }
  } else add('state.writable', false, 'state directory was not provided', 'provide --state-dir inside the run directory')
  if (expectedVersion) {
    const npm = spawnSync('npm', ['view', '@agentskit/code-review', 'version'], { encoding: 'utf8', timeout: 30_000 })
    const actual = npm.status === 0 ? npm.stdout.trim() : ''
    add('package.version', actual === expectedVersion, `published=${actual || 'unavailable'}, expected=${expectedVersion}`, 'publish the expected package version before starting')
  } else add('package.version', false, 'expected package version was not provided', 'pin --expected-version to an immutable published version')
  const report = runBlockerSweep(checks)
  if (report.status === 'ready') {
    const manifest = `${stateDir}/batch-manifest.json`
    const args = ['dist/src/cli.js', '--config', configFile, '--pr', pr, '--provider', provider, '--health-check', 'off', '--plan', '--json', '--batch-size', value('batch-size') ?? '5', '--batch-manifest', manifest]
    const plan = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000 })
    add('plan.complete', plan.status === 0, plan.status === 0 ? 'complete provider-free plan generated' : (plan.stderr.trim() || 'plan failed'), 'fix the plan failure before creating a worktree')
  }
  const finalReport = runBlockerSweep(checks)
  const reportFile = value('report')
  if (reportFile) writeFileSync(reportFile, JSON.stringify(finalReport, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ ...finalReport, canStartLiveReview: finalReport.status === 'ready' }, null, 2))
  process.exit(finalReport.status === 'blocked' ? 2 : 0)
}
if (initRun) {
  const batches = value('batches')?.split(',').filter(Boolean).map(Number) ?? []
  writeState(createHarnessRun({ runId: initRun, batchIndices: batches }))
  console.log(JSON.stringify(JSON.parse(readFileSync(stateFile, 'utf8')), null, 2))
  process.exit(0)
}
if (completeBatch !== undefined) {
  const state = json(stateFile, 'state')
  writeState(recordBatchCompletion(state, Number(completeBatch)))
  console.log(JSON.stringify(JSON.parse(readFileSync(stateFile, 'utf8')), null, 2))
  process.exit(0)
}
if (canaryStatus) {
  if (!['ready', 'blocked'].includes(canaryStatus)) throw new Error('--canary-status must be ready or blocked')
  const state = json(stateFile, 'state')
  const result = { ready: canaryStatus === 'ready', blockers: [], artifact: {} }
  writeState(recordCanaryAttempt(state, result))
  console.log(JSON.stringify(JSON.parse(readFileSync(stateFile, 'utf8')), null, 2))
  process.exit(0)
}
if (!checksFile && !(manifestFile && artifactFile) && !replay) {
  throw new Error('use --checks <json>, --manifest <json> --artifact <json>, or --replay')
}
const replayRun = replay ? spawnSync(process.execPath, ['--test', 'test/harness.test.mjs'], { encoding: 'utf8' }) : undefined
const report = replay
  ? { status: replayRun.status === 0 ? 'ready' : 'blocked', blockers: replayRun.status === 0 ? [] : [{ id: 'replay.tests', severity: 'blocker', ok: false, detail: replayRun.stderr.trim() || replayRun.stdout.trim() }] }
  : checksFile ? runBlockerSweep(json(checksFile, 'checks')) : validateCanary(json(manifestFile, 'manifest'), json(artifactFile, 'artifact'))
const reportFile = value('report')
if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
if (report.status === 'blocked' || report.ready === false) process.exitCode = 2
