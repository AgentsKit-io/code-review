import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { scoreCorpusCases } from '../scripts/review-cycle.mjs'

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
