import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateBenchmark, parseBenchmarkDataset } from '../dist/src/reviewer-benchmark.js'

const prs = Array.from({ length: 30 }, (_, i) => i % 2
  ? { id: `r#${i}`, repository: 'o/r', number: i + 1, label: 'clean', bugs: [] }
  : { id: `r#${i}`, repository: 'o/r', number: i + 1, label: 'buggy', bugs: [{ file: 'a.ts', line: 10, titleIncludes: ['null'], note: 'null deref' }] })
const dataset = parseBenchmarkDataset({ version: 1, prs })
const hit = { file: 'a.ts', line: 11, title: 'Null dereference' }
const noise = { file: 'b.ts', line: 1, title: 'style' }
const runs = (pick) => Object.fromEntries(dataset.prs.map((pr) => [pr.id, pick(pr)]))
const run = (findings, costUsd) => ({ findings, costUsd, latencyMs: 100 })

test('passes when bugs >= incumbent, fewer false positives and cost within 20%', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit, noise] : [noise], 1))
  const candidate = runs((pr) => run(pr.bugs.length ? [hit] : [], 1.2))
  const report = evaluateBenchmark(dataset, incumbent, candidate)
  assert.equal(report.decision, 'PASS')
  assert.equal(report.candidate.bugsFound, 15)
})

test('fails on missed bugs, equal false positives or cost over 20%', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit] : [noise], 1))
  assert.equal(evaluateBenchmark(dataset, incumbent, runs(() => run([noise], 1))).decision, 'FAIL')
  assert.equal(evaluateBenchmark(dataset, incumbent, runs((pr) => run(pr.bugs.length ? [hit] : [noise], 1))).decision, 'FAIL')
  assert.equal(evaluateBenchmark(dataset, incumbent, runs((pr) => run(pr.bugs.length ? [hit] : [], 1.21))).decision, 'FAIL')
})

test('is blocked for a small dataset or an errored run', () => {
  const small = parseBenchmarkDataset({ version: 1, prs: prs.slice(0, 2) })
  assert.equal(evaluateBenchmark(small, {}, {}).decision, 'BLOCKED')
  const ok = runs(() => run([], 1))
  const broken = { ...ok, [dataset.prs[0].id]: { ...ok[dataset.prs[0].id], error: 'exit 1' } }
  assert.equal(evaluateBenchmark(dataset, ok, broken).decision, 'BLOCKED')
})

test('rejects malformed labels and the shipped dataset parses', () => {
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, label: 'clean', bugs: [{ file: 'a', line: 1, note: 'n' }] }] }))
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, label: 'buggy', bugs: [] }] }))
})
