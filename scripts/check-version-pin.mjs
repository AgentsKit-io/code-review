#!/usr/bin/env node
// Gate for the code-review version the factory line installs (RF-09).
//   node scripts/check-version-pin.mjs --pin <x.y.z | @agentskit/code-review@x.y.z> [--report <report.json>] [--dataset <prs.json>]
// Exits 0 only when the pin is an exact version, the benchmark report is PASS for that version and the report was
// run on the current labelled dataset (sha256). Anything else exits 2: re-measure against the incumbent first.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkVersionPin } from '../dist/src/reviewer-benchmark.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const value = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const pin = value('pin')
if (!pin) {
  process.stderr.write('--pin <version> is required\n')
  process.exit(64)
}
const report = JSON.parse(readFileSync(resolve(value('report') ?? join(root, 'quality/benchmark/report.json')), 'utf8'))
const datasetSha256 = createHash('sha256').update(readFileSync(resolve(value('dataset') ?? join(root, 'quality/benchmark/prs.json')))).digest('hex')
const result = checkVersionPin(report, pin, datasetSha256)
if (result.ok) process.stdout.write(`version pin ok: @agentskit/code-review@${result.version}\n`)
else {
  process.stderr.write(`version pin rejected:\n${result.reasons.map((reason) => `- ${reason}`).join('\n')}\n`)
  process.exitCode = 2
}
