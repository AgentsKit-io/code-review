#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { blockedQualityReport, compareQuality, evaluateQuality, evaluateQualityAgainstBaseline, parseQualityInput } from '../dist/src/quality-matrix.js'

const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const inputPath = value('input')
let report
if (!inputPath) report = blockedQualityReport('--input <quality-input.json> is required; use a real runner artifact')
else {
  try {
    const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
    report = evaluateQuality(parseQualityInput(input))
  } catch (error) {
    report = blockedQualityReport(error instanceof Error ? error.message : String(error))
  }
}
const baselinePath = value('baseline')
let output = report
if (baselinePath && !report.inputError) {
  try {
    const baseline = JSON.parse(readFileSync(resolve(baselinePath), 'utf8'))
    const baselineReport = baseline.areas ? baseline : evaluateQuality(parseQualityInput(baseline))
    const comparison = compareQuality(report, baselineReport, { maxScoreDrop: Number(value('max-score-drop') ?? 1) })
    output = { ...evaluateQualityAgainstBaseline(parseQualityInput(JSON.parse(readFileSync(resolve(inputPath), 'utf8'))), baselineReport, { maxScoreDrop: Number(value('max-score-drop') ?? 1) }), comparison }
  } catch (error) {
    output = blockedQualityReport(error instanceof Error ? `invalid quality baseline: ${error.message}` : String(error))
  }
}
const outputPath = value('output')
if (outputPath) writeFileSync(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
if (report.decision !== 'PASS') process.exitCode = 2
