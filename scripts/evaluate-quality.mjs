#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateQuality, compareQuality } from '../dist/src/quality-matrix.js'

const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const inputPath = value('input')
if (!inputPath) throw new Error('--input <quality-input.json> is required')
const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
const report = evaluateQuality(input)
const baselinePath = value('baseline')
const output = baselinePath
  ? { ...report, comparison: compareQuality(report, JSON.parse(readFileSync(resolve(baselinePath), 'utf8'))) }
  : report
const outputPath = value('output')
if (outputPath) writeFileSync(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
if (report.decision !== 'PASS') process.exitCode = 2
