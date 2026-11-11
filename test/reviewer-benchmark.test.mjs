import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { checkVersionPin, describeBenchmarkSet, describeFailure, falsePositiveCategories, evaluateBenchmark, parseBenchmarkDataset, parsePriceTable, pinnedCommitError, priceRun, renderBenchmarkMarkdown } from '../dist/src/reviewer-benchmark.js'

const commitOf = (i) => String(i % 10).repeat(40)
const prs = Array.from({ length: 30 }, (_, i) => i % 2
  ? { id: `r#${i}`, repository: 'o/r', number: i + 1, commit: commitOf(i), label: 'clean', bugs: [] }
  : { id: `r#${i}`, repository: 'o/r', number: i + 1, commit: commitOf(i), label: 'buggy', bugs: [{ file: 'a.ts', line: 10, titleIncludes: ['null'], note: 'null deref' }] })
const dataset = parseBenchmarkDataset({ version: 1, prs })
const hit = { file: 'a.ts', line: 11, title: 'Null dereference' }
const noise = { file: 'b.ts', line: 1, title: 'style' }
const runs = (pick) => Object.fromEntries(dataset.prs.map((pr) => [pr.id, pick(pr)]))
const prices = parsePriceTable(JSON.parse(readFileSync(new URL('../quality/benchmark/prices.json', import.meta.url), 'utf8')))
// 1 US$ per PR at the claude-sonnet-5-5 rates (3 in / 15 out per Mtok): 200k in + 26_667 out ~ 1.0
const run = (findings, cost) => ({ findings, model: 'claude-sonnet-5-5', inputTokens: Math.round(cost * 200_000), outputTokens: Math.round(cost * 26_666.67), latencyMs: 100 })
const evaluate = (d, i, c, options) => evaluateBenchmark(d, i, c, prices, options)

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
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, commit: commitOf(1), label: 'clean', bugs: [{ file: 'a', line: 1, note: 'n' }] }] }))
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, commit: commitOf(1), label: 'buggy', bugs: [] }] }))
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ id: 'x', repository: 'o/r', number: 1, commit: commitOf(1), label: 'buggy', bugs: [{ file: 'a', line: 1, note: 'n', fix: { pr: 2, commit: 'abc' } }] }] }))
})

test('RF-05: reports the candidate p90 latency and fails when it exceeds the review-stage time', () => {
  const incumbent = runs((pr) => run(pr.bugs.length ? [hit, noise] : [noise], 1))
  // 27 PRs at 1s and 3 at 10s: the nearest-rank p90 is the 27th value, still 1s.
  const timed = (slowCount) => runs((pr) => ({ ...run(pr.bugs.length ? [hit] : [], 1), latencyMs: Number(pr.id.split('#')[1]) < slowCount * 2 ? 10_000 : 1_000 }))
  const within = evaluate(dataset, incumbent, timed(0), { stageTimeoutMs: 2_000 })
  assert.equal(within.candidate.p90LatencyMs, 1_000)
  assert.equal(within.decision, 'PASS')
  const over = evaluate(dataset, incumbent, timed(5), { stageTimeoutMs: 2_000 })
  assert.equal(over.candidate.p90LatencyMs, 10_000)
  assert.equal(over.decision, 'FAIL')
  assert.match(over.reasons.join('\n'), /p90 latency/)
  assert.equal(evaluate(dataset, incumbent, timed(5)).decision, 'PASS')
})

test('the report records the measured candidate version and dataset digest', () => {
  const ok = runs(() => run([], 1))
  const report = evaluate(dataset, ok, ok, { candidateVersion: '1.2.3', datasetSha256: 'abc' })
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

test('a PR without a pinned 40-hex commit is rejected', () => {
  const { commit, ...unpinned } = prs[0]
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [unpinned] }), /commit/)
  assert.throws(() => parseBenchmarkDataset({ version: 1, prs: [{ ...prs[0], commit: 'abc' }] }), /commit/)
})

test('the shipped set pins one commit per PR and lists PRs from the repositories where both reviewers run', () => {
  const shipped = parseBenchmarkDataset(JSON.parse(readFileSync(new URL('../quality/benchmark/prs.json', import.meta.url), 'utf8')))
  const info = describeBenchmarkSet(shipped)
  assert.ok(info.prs >= 30 && info.buggy > 0 && info.clean > 0)
  assert.equal(new Set(shipped.prs.map((pr) => `${pr.repository}#${pr.number}`)).size, shipped.prs.length)
  assert.ok(shipped.prs.every((pr) => pr.id === `${pr.repository}#${pr.number}`))
  assert.deepEqual(info.repositories, ['AgentsKit-io/code-review', 'AgentsKit-io/doc-bridge', 'AgentsKit-io/harness'])
})

test('the set digest changes when a pinned commit changes', () => {
  const moved = parseBenchmarkDataset({ version: 1, prs: [{ ...prs[0], commit: 'f'.repeat(40) }, ...prs.slice(1)] })
  assert.equal(describeBenchmarkSet(dataset).digest, describeBenchmarkSet(dataset).digest)
  assert.notEqual(describeBenchmarkSet(dataset).digest, describeBenchmarkSet(moved).digest)
  assert.match(describeBenchmarkSet(dataset).digest, /^[0-9a-f]{64}$/)
})

test('pinnedCommitError accepts only the pinned head', () => {
  assert.equal(pinnedCommitError(dataset.prs[0], dataset.prs[0].commit), undefined)
  assert.match(pinnedCommitError(dataset.prs[0], 'f'.repeat(40)), /not the pinned/)
  assert.match(pinnedCommitError(dataset.prs[0], undefined), /could not read/)
})

test('the report says which set and which version were used, with the commit given to both reviewers', () => {
  const ok = runs(() => run([], 1))
  const report = evaluate(dataset, ok, ok, { setPath: 'quality/benchmark/prs.json', run: { codeReviewVersion: '9.9.9', gitCommit: 'a'.repeat(40) } })
  assert.equal(report.set.digest, describeBenchmarkSet(dataset).digest)
  const markdown = renderBenchmarkMarkdown(report)
  assert.match(markdown, /mvp:RF-01/)
  assert.match(markdown, new RegExp(`sha256 \\\`${report.set.digest}\\\``))
  assert.match(markdown, /code-review: `9\.9\.9` at commit `a{40}`/)
  assert.match(markdown, /\| r#0 \| buggy \| `0{40}` \|/)
})

const root = new URL('..', import.meta.url).pathname

async function runBenchmark(headOf, { incumbent, candidate, prs: setPrs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-runner-test-'))
  const server = createServer((req, res) => {
    const head = headOf(req.url)
    res.writeHead(head ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ head: { sha: head } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const log = join(dir, 'calls.log')
    const reviewer = join(dir, 'reviewer.mjs')
    writeFileSync(reviewer, `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n')\nprocess.stdout.write('{"findings":[],"model":"claude-sonnet-5-5","inputTokens":1000,"outputTokens":1000}\\n')\n`, { mode: 0o755 })
    const wrap = (script) => {
      const path = join(dir, `${script === reviewer ? 'reviewer' : script.split('/').pop()}.sh`)
      writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 })
      return path
    }
    // A stub that prints, per PR number, the findings given (empty when absent).
    const stubFor = (name, byNumber) => {
      const script = join(dir, `${name}.mjs`)
      writeFileSync(script, `const by = ${JSON.stringify(byNumber)}\nprocess.stdout.write(JSON.stringify({ findings: by[process.argv[3]] ?? [], model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 1000 }) + '\\n')\n`)
      return wrap(script)
    }
    const wrapper = wrap(reviewer)
    const incumbentCmd = incumbent ? stubFor('incumbent', incumbent) : wrapper
    const candidateCmd = candidate ? stubFor('candidate', candidate) : wrapper
    const small = { version: 1, prs: setPrs ?? dataset.prs.slice(0, 2) }
    const file = join(dir, 'set.json')
    writeFileSync(file, JSON.stringify(small))
    const output = join(dir, 'report.json')
    const child = spawn(process.execPath, [join(root, 'scripts/run-reviewer-benchmark.mjs'), '--incumbent-cmd', incumbentCmd, '--candidate-cmd', candidateCmd, '--dataset', file, '--output', output], {
      env: { ...process.env, AGENTSKIT_BENCHMARK_GITHUB_API: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: 'test-token' },
      stdio: 'ignore',
    })
    await new Promise((resolve) => child.on('close', resolve))
    const calls = readFileSync(log, { flag: 'a+' }).toString().split('\n').filter(Boolean)
    return { calls, report: JSON.parse(readFileSync(output, 'utf8')), small }
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the runner gives both reviewers the same PRs at the same pinned commit and reports the set and version', async () => {
  const { calls, report, small } = await runBenchmark((url) => small0.get(url.split('/pulls/')[1]))
  assert.equal(calls.length, 4)
  for (const pr of small.prs) assert.equal(calls.filter((c) => c === `${pr.repository} ${pr.number} ${pr.commit}`).length, 2)
  assert.equal(report.set.prs, 2)
  assert.equal(report.set.digest, describeBenchmarkSet(parseBenchmarkDataset(small)).digest)
  assert.equal(report.run.codeReviewVersion, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  assert.equal(report.incumbent.erroredPrs, 0)
  assert.equal(report.candidate.erroredPrs, 0)
})

test('the runner does not review a PR whose head is not the pinned commit and errors both reviewers', async () => {
  const { calls, report } = await runBenchmark((url) => (url.endsWith(`/pulls/${prs[0].number}`) ? 'e'.repeat(40) : small0.get(url.split('/pulls/')[1])))
  assert.equal(calls.length, 2)
  assert.equal(report.incumbent.erroredPrs, 1)
  assert.equal(report.candidate.erroredPrs, 1)
  assert.match(report.incumbent.perPr[0].error, /not the pinned/)
  assert.equal(report.decision, 'BLOCKED')
})

const small0 = new Map(dataset.prs.slice(0, 2).map((pr) => [String(pr.number), pr.commit]))

test('#379: records each finding with its verdict and matched bug, a readable failure cause, and groups false positives by title', () => {
  // Recorded outputs of a fake reviewer: one right finding, one wrong, one crash.
  const recorded = {
    right: { findings: [{ file: 'a.ts', line: 11, title: 'Null dereference' }], latencyMs: 5 },
    wrong: { findings: [{ file: 'b.ts', line: 1, title: 'Unused variable' }, { file: 'c.ts', line: 2, title: 'unused  variable' }], latencyMs: 5 },
    crash: { findings: [], latencyMs: 5, error: 'exit 2: shadow-review: review failed', errorDetail: describeFailure('review', 2, ['loading', 'ANTHROPIC_API_KEY=sk-ant-abcdef123456', 'Authorization: Bearer abcdefghij123456', 'shadow-review: review failed'].join('\n')) },
  }
  const set = parseBenchmarkDataset({ version: 1, prs: [
    { id: 'o/r#1', repository: 'o/r', number: 1, commit: commitOf(1), label: 'buggy', bugs: [{ file: 'a.ts', line: 10, titleIncludes: ['null'], note: 'null deref' }] },
    { id: 'o/r#2', repository: 'o/r', number: 2, commit: commitOf(2), label: 'clean', bugs: [] },
    { id: 'o/r#3', repository: 'o/r', number: 3, commit: commitOf(3), label: 'clean', bugs: [] },
  ] })
  const report = evaluate(set, { 'o/r#1': recorded.right, 'o/r#2': recorded.wrong, 'o/r#3': recorded.crash }, { 'o/r#1': recorded.right, 'o/r#2': recorded.right, 'o/r#3': recorded.right })
  const [one, two, three] = report.incumbent.perPr
  assert.deepEqual(one.findings, [{ file: 'a.ts', line: 11, title: 'Null dereference', verdict: 'real-bug', matchedBug: { file: 'a.ts', line: 10, note: 'null deref' } }])
  assert.deepEqual(two.findings.map((f) => f.verdict), ['false-positive', 'false-positive'])
  assert.equal(three.errorDetail.exitCode, 2)
  assert.equal(three.errorDetail.stage, 'review')
  const tail = three.errorDetail.stderrTail.join('\n')
  assert.match(tail, /review failed/)
  assert.doesNotMatch(tail, /sk-ant|abcdefghij123456/)
  assert.deepEqual(falsePositiveCategories(report.incumbent), [{ category: 'unused variable', count: 2, examples: ['o/r#2 b.ts:1', 'o/r#2 c.ts:2'] }])
  const markdown = renderBenchmarkMarkdown(report)
  assert.match(markdown, /## Falsos positivos por categoria/)
  assert.match(markdown, /\| unused variable \| 2 \|/)
  assert.match(markdown, /\| incumbent \| o\/r#3 \| review \| 2 \|/)
})

const checkReportSchema = (report) => {
  assert.ok(['PASS', 'FAIL', 'BLOCKED'].includes(report.decision))
  assert.ok(Array.isArray(report.reasons) && report.reasons.every((r) => typeof r === 'string'))
  assert.ok(Array.isArray(report.set.prs))
  assert.match(report.set.digest, /^[0-9a-f]{64}$/)
  assert.equal(typeof report.run.codeReviewVersion, 'string')
  for (const side of [report.incumbent, report.candidate]) {
    assert.equal(typeof side.name, 'string')
    for (const key of ['bugsFound', 'bugsKnown', 'falsePositives', 'inputTokens', 'outputTokens', 'costUsd', 'meanLatencyMs', 'p90LatencyMs', 'erroredPrs']) assert.equal(typeof side[key], 'number', key)
    assert.ok(Array.isArray(side.perPr))
    assert.equal(side.erroredPrs, side.perPr.filter((p) => p.error).length)
    for (const p of side.perPr) {
      assert.equal(typeof p.id, 'string')
      if (p.error) { assert.equal(typeof p.error, 'string'); continue }
      for (const key of ['bugsFound', 'bugsKnown', 'falsePositives', 'inputTokens', 'outputTokens', 'costUsd', 'latencyMs']) assert.equal(typeof p[key], 'number', `${p.id} ${key}`)
    }
    assert.equal(side.bugsFound, side.perPr.reduce((n, p) => n + (p.bugsFound ?? 0), 0))
    assert.equal(side.falsePositives, side.perPr.reduce((n, p) => n + (p.falsePositives ?? 0), 0))
  }
  assert.deepEqual(report.incumbent.perPr.map((p) => p.id), report.candidate.perPr.map((p) => p.id))
}

test('RF-02: the shipped quality/benchmark/report.json follows the report schema', () => {
  checkReportSchema(JSON.parse(readFileSync(new URL('../quality/benchmark/report.json', import.meta.url), 'utf8')))
})

test('RF-02: a stubbed incumbent run counts real bugs and false positives of both reviewers by the same rule', async () => {
  const [first, second] = dataset.prs.slice(0, 2)
  const set = [
    { ...first, label: 'buggy', bugs: [{ file: 'a.ts', line: 10, lineTolerance: 5, titleIncludes: ['null'], note: 'null deref' }] },
    { ...second, label: 'clean', bugs: [] },
  ]
  const hit = { file: 'a.ts', line: 11, title: 'Null dereference' }
  const noise = { file: 'b.ts', line: 1, title: 'style' }
  const { report } = await runBenchmark((url) => small0.get(url.split('/pulls/')[1]), {
    prs: set,
    incumbent: { [first.number]: [hit, noise], [second.number]: [noise] },
    candidate: { [first.number]: [hit] },
  })
  checkReportSchema(report)
  const counts = (side) => ({ total: [side.bugsFound, side.falsePositives], perPr: side.perPr.map((p) => [p.bugsFound, p.falsePositives]) })
  assert.deepEqual(counts(report.incumbent), { total: [1, 2], perPr: [[1, 1], [0, 1]] })
  assert.deepEqual(counts(report.candidate), { total: [1, 0], perPr: [[1, 0], [0, 0]] })
  assert.equal(report.incumbent.erroredPrs, 0)
  assert.equal(report.candidate.erroredPrs, 0)
})
