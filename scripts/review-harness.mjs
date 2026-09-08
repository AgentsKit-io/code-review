#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { validateCanary, runBlockerSweep } from '../dist/src/harness.js'

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
