#!/usr/bin/env node
// Offline report for the one-week shadow run; applies the benchmark's three criteria to the week's data.
//   node scripts/render-shadow-week-report.mjs <shadow-week.json> [--output <report.json>] [--markdown <report.md>]
// Exit code is 2 unless the decision is PASS. Nothing here calls a provider or the network.
import { readFileSync, writeFileSync } from 'node:fs'
import { evaluateShadowWeek, parseShadowWeekData, renderShadowWeekMarkdown } from '../dist/src/shadow-week.js'

const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const input = process.argv[2]
if (!input || input.startsWith('--')) {
  process.stderr.write('usage: render-shadow-week-report.mjs <shadow-week.json> [--output <report.json>] [--markdown <report.md>]\n')
  process.exit(64)
}
const report = evaluateShadowWeek(parseShadowWeekData(JSON.parse(readFileSync(input, 'utf8'))))
const markdown = renderShadowWeekMarkdown(report)
if (value('output')) writeFileSync(value('output'), `${JSON.stringify(report, null, 2)}\n`)
if (value('markdown')) writeFileSync(value('markdown'), markdown)
process.stdout.write(markdown)
process.exit(report.decision === 'PASS' ? 0 : 2)
