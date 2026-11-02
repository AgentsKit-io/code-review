import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { checkVersionPin, evaluateBenchmark, parseBenchmarkDataset, renderBenchmarkMarkdown } from '../dist/src/reviewer-benchmark.js'

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

test('the report records the measured candidate version and dataset digest', () => {
  const ok = runs(() => run([], 1))
  const report = evaluateBenchmark(dataset, ok, ok, { candidateVersion: '1.2.3', datasetSha256: 'abc' })
  assert.equal(report.candidateVersion, '1.2.3')
  assert.equal(report.datasetSha256, 'abc')
  assert.match(renderBenchmarkMarkdown(report), /Candidate version: 1\.2\.3; dataset sha256: abc/)
})

test('a version pin needs an exact version that passed on the current dataset', () => {
  const pass = { decision: 'PASS', candidateVersion: '1.2.3', datasetSha256: 'abc' }
  assert.deepEqual(checkVersionPin(pass, '1.2.3', 'abc'), { ok: true, version: '1.2.3', reasons: [] })
  assert.equal(checkVersionPin(pass, '@agentskit/code-review@1.2.3', 'abc').ok, true)
  for (const loose of ['latest', '@agentskit/code-review@latest', '^1.2.3', '~1.2.3', '1.x', '>=1.2.3']) assert.equal(checkVersionPin(pass, loose, 'abc').ok, false, loose)
  assert.match(checkVersionPin(pass, '1.2.4', 'abc').reasons.join(), /was not measured/)
  assert.match(checkVersionPin({ ...pass, decision: 'BLOCKED' }, '1.2.3', 'abc').reasons.join(), /not PASS/)
  assert.match(checkVersionPin({ decision: 'PASS' }, '1.2.3').reasons.join(), /does not record/)
  assert.match(checkVersionPin(pass, '1.2.3', 'changed').reasons.join(), /current labelled dataset/)
})

test('check-version-pin rejects the shipped report, which is not PASS', () => {
  const script = fileURLToPath(new URL('../scripts/check-version-pin.mjs', import.meta.url))
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const result = spawnSync(process.execPath, [script, '--pin', version], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /not PASS/)
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 64)
})

test('the report shows both reviewers per PR and in total with the counting rule and reproduction commands', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit, noise] : [noise], 1))
  const candidate = runs((pr) => run(pr.bugs.length ? [hit] : [], 1))
  const markdown = renderBenchmarkMarkdown(evaluateBenchmark(dataset, incumbent, candidate))
  assert.match(markdown, /mvp:RF-02/)
  assert.match(markdown, /\| r#0 \| 1\/1 \| 1 \| 1\/1 \| 0 \|/)
  assert.match(markdown, /\| \*\*Total\*\* \| \*\*15\/15\*\* \| \*\*30\*\* \| \*\*15\/15\*\* \| \*\*0\*\* \|/)
  assert.match(markdown, /## Counting rule/)
  assert.match(markdown, /run-reviewer-benchmark\.mjs/)
})
