import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const model = join(root, 'test/fixtures/bin/incumbent-model')

async function withGithub(fn) {
  const server = createServer((req, res) => {
    if (/^\/repos\/o\/r\/pulls\/404$/.test(req.url)) { res.statusCode = 404; res.end('no'); return }
    const head = /^\/repos\/o\/r\/pulls\/\d+$/.test(req.url) && String(req.headers.accept).includes('application/vnd.github+json')
    if (head) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ head: { sha: 'a'.repeat(40) } })); return }
    res.end('diff --git a/a.ts b/a.ts\n+const x = null\n')
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  try { return await fn(`http://127.0.0.1:${server.address().port}`) } finally { server.close() }
}

// Async spawn: the fake GitHub server lives in this process, so a synchronous spawn would deadlock it.
const run = (command, args, env) => new Promise((done) => {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => { stdout += c })
  child.stderr.on('data', (c) => { stderr += c })
  child.on('close', (status) => done({ status, stdout, stderr }))
})
const incumbent = (api, args, extra = {}) => run(process.execPath, [join(root, 'scripts/incumbent-review.mjs'), ...args], {
  GITHUB_API_URL: api, AGENTSKIT_INCUMBENT_CMD: model, AGENTSKIT_INCUMBENT_ARGS: '[]', AGENTSKIT_INCUMBENT_USD_PER_MTOK: '5', ...extra,
})

test('RF-03: prints {"findings":[{file,line,title}],"costUsd"} with the cost taken from the tokens', () => withGithub(async (api) => {
  const out = await incumbent(api, ['o/r', '7'])
  assert.equal(out.status, 0, out.stderr)
  assert.deepEqual(JSON.parse(out.stdout), { findings: [{ file: 'a.ts', line: 11, title: 'Null dereference' }], costUsd: 5 })
}))

test('RF-03: a reviewer without findings is a clean answer; failures exit non-zero instead of scoring as clean', () => withGithub(async (api) => {
  const clean = await incumbent(api, ['o/r', '7'], { INCUMBENT_FIXTURE_ANSWER: '{"findings":[]}' })
  assert.deepEqual(JSON.parse(clean.stdout).findings, [])
  for (const extra of [{ INCUMBENT_FIXTURE_FAIL: '1' }, { INCUMBENT_FIXTURE_ANSWER: 'looks fine to me' }, { INCUMBENT_FIXTURE_ANSWER: '{"findings":[{"file":"a.ts"}]}' }]) {
    assert.notEqual((await incumbent(api, ['o/r', '7'], extra)).status, 0, JSON.stringify(extra))
  }
  assert.notEqual((await incumbent(api, ['o/r', '404'])).status, 0)
  assert.equal((await incumbent(api, ['not-a-repo', 'x'])).status, 64)
  assert.equal((await incumbent(api, ['o/r', '7', 'xyz'])).status, 64)
  assert.equal((await incumbent(api, ['o/r', '7', 'a'.repeat(40)])).status, 0)
  const moved = await incumbent(api, ['o/r', '7', 'b'.repeat(40)])
  assert.notEqual(moved.status, 0)
  assert.match(moved.stderr, /pinned commit/)
}))

test('RF-03: run-reviewer-benchmark --incumbent-cmd finishes with no incumbent PR in error', () => withGithub(async (api) => {
  const dir = mkdtempSync(join(tmpdir(), 'incumbent-benchmark-'))
  try {
    const prs = Array.from({ length: 30 }, (_, i) => i % 2
      ? { id: `r#${i}`, repository: 'o/r', number: i + 1, commit: 'a'.repeat(40), label: 'clean', bugs: [] }
      : { id: `r#${i}`, repository: 'o/r', number: i + 1, commit: 'a'.repeat(40), label: 'buggy', bugs: [{ file: 'a.ts', line: 10, note: 'null deref' }] })
    const dataset = join(dir, 'prs.json')
    const output = join(dir, 'report.json')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(dataset, JSON.stringify({ version: 1, prs }))
    const bench = await run(process.execPath, [join(root, 'scripts/run-reviewer-benchmark.mjs'), '--incumbent-cmd', join(root, 'scripts/incumbent-review.mjs'),
      '--candidate-cmd', join(root, 'scripts/incumbent-review.mjs'), '--dataset', dataset, '--output', output, '--concurrency', '4'], {
      GITHUB_API_URL: api, AGENTSKIT_BENCHMARK_GITHUB_API: api, AGENTSKIT_INCUMBENT_CMD: model, AGENTSKIT_INCUMBENT_ARGS: '[]', AGENTSKIT_INCUMBENT_USD_PER_MTOK: '5',
    })
    assert.ok([0, 2].includes(bench.status), bench.stderr)
    const report = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(report.incumbent.erroredPrs, 0)
    assert.equal(report.incumbent.perPr.length, 30)
    assert.equal(report.incumbent.bugsFound, 15)
    assert.notEqual(report.decision, 'BLOCKED')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}))
