import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { decideLineReview, incompleteReason, LINE_DECISION_EXIT, parseLineFailurePolicy } from '../dist/src/line-reviewer.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const complete = { verdict: 'APPROVE', blocking: false, incomplete: false, execution: { attempted: 4, succeeded: 4, failed: 0 }, evidence: { deadlineExceeded: false } }

test('RF-10: without a benchmark PASS the incumbent stays the reviewer', () => {
  for (const benchmarkDecision of ['BLOCKED', 'FAIL', undefined]) {
    const decided = decideLineReview({ benchmarkDecision, review: complete })
    assert.equal(decided.decision, 'fallback')
    assert.equal(decided.decidedBy, 'incumbent')
  }
})

test('RF-10: a complete review decides; blocking findings request changes', () => {
  assert.equal(decideLineReview({ benchmarkDecision: 'PASS', review: complete }).decision, 'approve')
  assert.equal(decideLineReview({ benchmarkDecision: 'PASS', review: { ...complete, verdict: 'COMMENT' } }).decision, 'approve')
  assert.equal(decideLineReview({ benchmarkDecision: 'PASS', review: { ...complete, verdict: 'REQUEST CHANGES' } }).decision, 'request_changes')
  assert.equal(decideLineReview({ benchmarkDecision: 'PASS', review: { ...complete, verdict: 'COMMENT', blocking: true } }).decision, 'request_changes')
})

test('RF-10: an incomplete or failed review never approves', () => {
  const notDone = [
    { review: { ...complete, incomplete: true } },
    { review: { ...complete, unreviewed: [{ file: 'a.ts' }] } },
    { review: { ...complete, missingRequiredLenses: ['security'] } },
    { review: { ...complete, evidence: { deadlineExceeded: true } } },
    { review: { ...complete, execution: { attempted: 4, succeeded: 3, failed: 1 } } },
    { review: { ...complete, execution: { attempted: 4, succeeded: 3, failed: 0 } } },
    { review: { ...complete, execution: undefined } },
    { failure: 'review failed (exit 2)', review: complete },
    {},
  ]
  for (const input of notDone) {
    const fallback = decideLineReview({ benchmarkDecision: 'PASS', ...input })
    assert.deepEqual([fallback.decision, fallback.decidedBy], ['fallback', 'incumbent'], JSON.stringify(input))
    const blocked = decideLineReview({ benchmarkDecision: 'PASS', onFailure: 'block', ...input })
    assert.deepEqual([blocked.decision, blocked.decidedBy], ['block', 'none'], JSON.stringify(input))
  }
  assert.equal(incompleteReason(complete), undefined)
  assert.equal(parseLineFailurePolicy(undefined), 'incumbent')
  assert.equal(parseLineFailurePolicy('block'), 'block')
  assert.throws(() => parseLineFailurePolicy('approve'), /incumbent or block/)
  assert.equal(LINE_DECISION_EXIT.approve, 0)
  assert.ok(Object.entries(LINE_DECISION_EXIT).every(([decision, code]) => decision === 'approve' || code !== 0))
})

const git = (cwd, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
}

function withCheckout(fn, { change = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'line-review-'))
  try {
    git(home, 'init', '-q', '-b', 'main')
    git(home, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(home, 'checkout', '-q', '-b', 'feature')
    if (change) {
      copyFileSync(join(root, 'test/fixtures/review/good.ts'), join(home, 'good.ts'))
      git(home, 'add', '.')
      git(home, 'commit', '-q', '-m', 'change')
    }
    const pass = join(home, '..', `${home.split('/').at(-1)}-report.json`)
    writeFileSync(pass, JSON.stringify({ decision: 'PASS', reasons: [] }))
    try { fn(home, pass) } finally { rmSync(pass, { force: true }) }
  } finally { rmSync(home, { recursive: true, force: true }) }
}

const lineReview = (home, env) => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/line-review.mjs')], {
    cwd: home, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, HOME: home, AGENTSKIT_LINE_BASE: 'main', AGENTSKIT_LINE_PROVIDER: 'codex-cli', AGENTSKIT_LINE_USD_PER_MTOK: '5', PATH: `${join(root, 'test/fixtures/bin')}:${process.env.PATH ?? ''}`, ...env },
  })
  return { status: run.status, stderr: run.stderr, last: JSON.parse(run.stdout.trimEnd().split('\n').at(-1)) }
}

test('RF-10: with the shipped benchmark report (not PASS) the line falls back without calling a provider', () => withCheckout((home) => {
  const calls = join(home, 'provider-calls')
  const run = lineReview(home, { CODEX_FIXTURE_COUNT_FILE: calls })
  assert.equal(run.status, 3, run.stderr)
  assert.equal(existsSync(calls), false, 'no provider call')
  assert.equal(run.last.decision, 'fallback')
  assert.equal(run.last.decidedBy, 'incumbent')
  assert.equal(run.last.benchmarkDecision, JSON.parse(readFileSync(join(root, 'quality/benchmark/report.json'), 'utf8')).decision)
}))

test('RF-10: after a PASS a complete review decides and the decision is recorded', () => withCheckout((home, pass) => {
  const record = join(home, 'decisions.jsonl')
  const run = lineReview(home, { AGENTSKIT_LINE_BENCHMARK_REPORT: pass, AGENTSKIT_LINE_RECORD: record })
  assert.equal(run.last.decidedBy, 'code-review', run.stderr)
  assert.equal(run.status, LINE_DECISION_EXIT[run.last.decision])
  assert.match(run.last.comment, /^## Code review/)
  const [first] = readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(first.decision, run.last.decision)
  assert.equal(first.benchmarkDecision, 'PASS')
}))

test('RF-10: after a PASS a failed review falls back to the incumbent, or blocks when configured', () => withCheckout((home, pass) => {
  const fallback = lineReview(home, { AGENTSKIT_LINE_BENCHMARK_REPORT: pass, CODEX_FIXTURE_FAIL_ALL: '1' })
  assert.equal(fallback.status, 3, fallback.stderr)
  assert.equal(fallback.last.decision, 'fallback')
  const blocked = lineReview(home, { AGENTSKIT_LINE_BENCHMARK_REPORT: pass, CODEX_FIXTURE_FAIL_ALL: '1', AGENTSKIT_LINE_ON_FAILURE: 'block' })
  assert.equal(blocked.status, 2, blocked.stderr)
  assert.equal(blocked.last.decision, 'block')
}))

test('RF-10: nothing reviewable is not an approval', () => withCheckout((home, pass) => {
  const run = lineReview(home, { AGENTSKIT_LINE_BENCHMARK_REPORT: pass })
  assert.equal(run.status, 3, run.stderr)
  assert.equal(run.last.decision, 'fallback')
}, { change: false }))

test('RF-10: the line command rejects a malformed PR reference and an unknown failure policy', () => {
  assert.equal(spawnSync(process.execPath, [join(root, 'scripts/line-review.mjs'), 'not a repo', 'x'], { encoding: 'utf8' }).status, 2)
  assert.equal(spawnSync(process.execPath, [join(root, 'scripts/line-review.mjs')], { encoding: 'utf8', env: { ...process.env, AGENTSKIT_LINE_ON_FAILURE: 'approve' } }).status, 2)
})
