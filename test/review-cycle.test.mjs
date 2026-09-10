import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { scoreCorpusCases, createCycleMeter, runCycleBatches } from '../scripts/review-cycle.mjs'

test('a failed batch cancels and drains its peer before reporting, without starting queued work', async () => {
  const controller = new AbortController()
  const started = []
  let peerSettled = false
  const failure = new Error('batch token budget exceeded')
  await assert.rejects(runCycleBatches([0, 1, 2, 3], 2, async index => {
    started.push(index)
    if (index === 1) { await Promise.resolve(); throw failure }
    await new Promise(resolve => controller.signal.addEventListener('abort', () => setTimeout(resolve, 10), { once: true }))
    peerSettled = true
    throw new Error('peer was cancelled')
  }, controller), error => error === failure)
  assert.equal(controller.signal.aborted, true)
  assert.equal(peerSettled, true)
  assert.deepEqual(started, [0, 1])
  await assert.rejects(runCycleBatches([4], 1, async index => started.push(index), controller), error => error === failure)
  assert.deepEqual(started, [0, 1])
})

test('npm-style symlink invokes the cycle instead of silently succeeding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-cycle-bin-'))
  try {
    const bin = join(directory, 'agentskit-review-cycle')
    symlinkSync(new URL('../scripts/review-cycle.mjs', import.meta.url), bin)
    const run = spawnSync(process.execPath, [bin], { encoding: 'utf8', timeout: 10_000 })
    assert.equal(run.status, 2, run.stderr)
    assert.match(run.stderr, /missing --repository/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('cycle totals include retries and evals, reserve concurrent work, and preserve unknown usage', () => {
  const evidence = (tokensUsed, providerCalls) => ({ tokensUsed, providerCalls, usage: { inputTokens: tokensUsed, outputTokens: 0 } })
  const meter = createCycleMeter({ maxTokens: 1000, maxCalls: 20 })
  const first = meter.begin('batch-attempt-1', 400, 2)
  const second = meter.begin('batch-attempt-2', 400, 2)
  assert.equal(first.maxTokens, 400)
  assert.equal(second.maxTokens, 300)
  first.finish(evidence(200, 2), 2)
  second.finish(evidence(100, 1), 0)
  meter.begin('quality-corpus', 400).finish(evidence(150, 2), 0)
  meter.begin('memory-with', 400).finish(evidence(90, 1), 0)
  meter.begin('memory-without', 400).finish(evidence(60, 1), 0)
  assert.equal(meter.report().recordedTokens, 600)
  assert.equal(meter.report().recordedCalls, 7)
  meter.begin('interrupted', 400).finish({ tokensUsed: 10, providerCalls: 2, usage: { outputTokens: 10 } }, null)
  assert.equal(meter.report().recordedTokens, null)
  assert.equal(meter.report().chargedTokens, 1000)
  const resumed = createCycleMeter({ maxTokens: 1000, maxCalls: 20, entries: meter.report().entries })
  assert.throws(() => resumed.begin('must-not-run', 1), /budget exhausted/)
})

test('a duplicate detection in one corpus case cannot satisfy a missed defect in another', () => {
  const finding = { file: 'snippet.ts', line: 1, severity: 'high', category: 'security', title: 'Missing authorization', rationale: 'Unprotected action', suggestion: 'Authorize first' }
  const metrics = scoreCorpusCases([
    { expected: [finding], review: { findings: [finding, finding] } },
    { expected: [finding], review: { findings: [] } },
  ])
  assert.equal(metrics.expected, 2)
  assert.equal(metrics.detectedExpected, 1)
  assert.equal(metrics.duplicates, 1)
})

test('resume retains the locked clock and distinct cumulative attempt receipts', () => {
  const source = readFileSync(new URL('../scripts/review-cycle.mjs', import.meta.url), 'utf8')
  assert.match(source, /cycleStartedAt = Date.parse\(contract.createdAt\)/)
  assert.match(source, /summary.startedAt = contract.createdAt/)
  assert.match(source, /remainingCycleMs\(\) <= 0/)
  assert.match(source, /batch-\$\{index\}-attempt-\$\{state.attempts\[index\]\}/)
})

test('cycle runner collects blockers and always writes its summary before failing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-review-cycle-'))
  try {
    const config = join(directory, 'config.json')
    writeFileSync(config, '{}')
    const run = spawnSync(process.execPath, ['scripts/review-cycle.mjs', '--repository', 'invalid', '--pull', '0', '--config', config, '--run-dir', directory], { encoding: 'utf8', timeout: 120_000 })
    assert.equal(run.status, 2, run.stderr)
    const preflight = JSON.parse(readFileSync(join(directory, 'preflight.json'), 'utf8'))
    const summary = JSON.parse(readFileSync(join(directory, 'cycle-summary.json'), 'utf8'))
    assert.equal(preflight.status, 'blocked')
    assert.ok(preflight.blockers.length >= 2)
    assert.ok(preflight.blockers.some((blocker) => blocker.id === 'config.valid'))
    assert.equal(summary.decision, 'BLOCKED')
    assert.equal(summary.phase, 'preflight')
    assert.notEqual(summary.sourceRevision, 'unknown')
    const matrix = JSON.parse(readFileSync(summary.artifacts.qualityReport, 'utf8'))
    assert.equal(matrix.decision, 'BLOCKED')
    assert.equal(matrix.runId, summary.runId)
    assert.ok(matrix.areas.every(area => area.status === 'not-measured'))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
