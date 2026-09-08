import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

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
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
