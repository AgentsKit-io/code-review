#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
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
const writeState = (state) => {
  if (!stateFile) throw new Error('missing --state')
  const temp = `${stateFile}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, stateFile)
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
