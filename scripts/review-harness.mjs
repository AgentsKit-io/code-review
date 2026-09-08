#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
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
if (!checksFile && !(manifestFile && artifactFile)) {
  throw new Error('use --checks <json> for preflight or --manifest <json> --artifact <json> for canary validation')
}
const report = checksFile
  ? runBlockerSweep(json(checksFile, 'checks'))
  : validateCanary(json(manifestFile, 'manifest'), json(artifactFile, 'artifact'))
const reportFile = value('report')
if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
if (report.status === 'blocked' || report.ready === false) process.exitCode = 2
