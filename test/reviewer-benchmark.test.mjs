import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateBenchmark, parseBenchmarkDataset, parsePriceTable, priceRun, renderBenchmarkMarkdown } from '../dist/src/reviewer-benchmark.js'

const prs = Array.from({ length: 30 }, (_, i) => i % 2
  ? { id: `r#${i}`, repository: 'o/r', number: i + 1, label: 'clean', bugs: [] }
  : { id: `r#${i}`, repository: 'o/r', number: i + 1, label: 'buggy', bugs: [{ file: 'a.ts', line: 10, titleIncludes: ['null'], note: 'null deref' }] })
const dataset = parseBenchmarkDataset({ version: 1, prs })
const hit = { file: 'a.ts', line: 11, title: 'Null dereference' }
const noise = { file: 'b.ts', line: 1, title: 'style' }
const runs = (pick) => Object.fromEntries(dataset.prs.map((pr) => [pr.id, pick(pr)]))
const prices = parsePriceTable(JSON.parse(readFileSync(new URL('../quality/benchmark/prices.json', import.meta.url), 'utf8')))
// 1 US$ per PR at the claude-sonnet-5-5 rates (3 in / 15 out per Mtok): 200k in + 26_667 out ~ 1.0
const run = (findings, cost) => ({ findings, model: 'claude-sonnet-5-5', inputTokens: Math.round(cost * 200_000), outputTokens: Math.round(cost * 26_666.67), latencyMs: 100 })
const evaluate = (d, i, c) => evaluateBenchmark(d, i, c, prices)

test('passes when bugs >= incumbent, fewer false positives and cost within 20%', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit, noise] : [noise], 1))
  const candidate = runs((pr) => run(pr.bugs.length ? [hit] : [], 1.2))
  const report = evaluate(dataset, incumbent, candidate)
  assert.equal(report.decision, 'PASS')
  assert.equal(report.candidate.bugsFound, 15)
})

test('fails on missed bugs, equal false positives or cost over 20%', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit] : [noise], 1))
  assert.equal(evaluate(dataset, incumbent, runs(() => run([noise], 1))).decision, 'FAIL')
  assert.equal(evaluate(dataset, incumbent, runs((pr) => run(pr.bugs.length ? [hit] : [noise], 1))).decision, 'FAIL')
  assert.equal(evaluate(dataset, incumbent, runs((pr) => run(pr.bugs.length ? [hit] : [], 1.21))).decision, 'FAIL')
})

test('is blocked for a small dataset or an errored run', () => {
  const small = parseBenchmarkDataset({ version: 1, prs: prs.slice(0, 2) })
  assert.equal(evaluate(small, {}, {}).decision, 'BLOCKED')
  const ok = runs(() => run([], 1))
  const broken = { ...ok, [dataset.prs[0].id]: { ...ok[dataset.prs[0].id], error: 'exit 1' } }
  assert.equal(evaluate(dataset, ok, broken).decision, 'BLOCKED')
})

test('the shipped dataset parses, has at least 30 PRs with both labels and cites a fix for every bug', () => {
  const shipped = parseBenchmarkDataset(JSON.parse(readFileSync(new URL('../quality/benchmark/prs.json', import.meta.url), 'utf8')))
  assert.ok(shipped.prs.length >= 30)
  assert.ok(shipped.prs.some((pr) => pr.label === 'buggy'))
  assert.ok(shipped.prs.some((pr) => pr.label === 'clean'))
  assert.ok(shipped.prs.every((pr) => /^AgentsKit-io\//.test(pr.repository)))
  for (const pr of shipped.prs.filter((p) => p.label === 'buggy')) for (const bug of pr.bugs) assert.ok(bug.fix, `${pr.id} ${bug.file}`)
})

test('rejects malformed labels and fix citations', () => {
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, label: 'clean', bugs: [{ file: 'a', line: 1, note: 'n' }] }] }))
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, label: 'buggy', bugs: [] }] }))
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, label: 'buggy', bugs: [{ file: 'a', line: 1, note: 'n', fix: { pr: 2, commit: 'abc' } }] }] }))
})

test('the report shows both reviewers per PR and in total with the counting rule and reproduction commands', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit, noise] : [noise], 1))
  const candidate = runs((pr) => run(pr.bugs.length ? [hit] : [], 1))
  const markdown = renderBenchmarkMarkdown(evaluate(dataset, incumbent, candidate))
  assert.match(markdown, /mvp:RF-02/)
  assert.match(markdown, /\| r#0 \| 1\/1 \| 1 \| 1\/1 \| 0 \|/)
  assert.match(markdown, /\| \*\*Total\*\* \| \*\*15\/15\*\* \| \*\*30\*\* \| \*\*15\/15\*\* \| \*\*0\*\* \|/)
  assert.match(markdown, /## Counting rule/)
  assert.match(markdown, /run-reviewer-benchmark\.mjs/)
})

test('cost comes from tokens and the shared price table, never zero for a completed PR', () => {
  assert.equal(priceRun(prices, { model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 }), 18)
  assert.equal(priceRun(prices, { model: 'claude-sonnet-5-5' }), undefined)
  assert.equal(priceRun(prices, { model: 'unknown', inputTokens: 1, outputTokens: 1 }), undefined)
  assert.equal(priceRun(prices, { model: 'claude-sonnet-5-5', inputTokens: 0, outputTokens: 0 }), undefined)
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit, noise] : [noise], 1))
  const noTokens = runs((pr) => ({ findings: pr.bugs.length ? [hit] : [], latencyMs: 1 }))
  const report = evaluate(dataset, incumbent, noTokens)
  assert.equal(report.decision, 'BLOCKED')
  assert.match(report.reasons.join('\n'), /without measured cost/)
  const ok = evaluate(dataset, incumbent, runs((pr) => run(pr.bugs.length ? [hit] : [], 1)))
  assert.ok(ok.incumbent.perPr.every((p) => p.costUsd > 0 && p.inputTokens > 0 && p.outputTokens > 0))
  assert.ok(ok.candidate.perPr.every((p) => p.costUsd > 0))
  assert.match(renderBenchmarkMarkdown(ok), /mvp:RF-04/)
  assert.doesNotMatch(renderBenchmarkMarkdown(ok), /\| 0\.0000 \|/)
})

test('the shipped price table parses', () => {
  assert.ok(Object.keys(prices.models).length > 0)
  assert.throws(() => parsePriceTable({ version: 1, effectiveDate: 'x', models: { m: { inputUsdPerMtok: 0, outputUsdPerMtok: 1 } } }))
})
