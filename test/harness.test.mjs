import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarnessContract, createHarnessRun, fingerprint, recordBatchCompletion, recordCanaryAttempt, runBlockerSweep, validateCanary } from '../dist/src/harness.js'

const state = {
  version: 1,
  repository: 'owner/repo',
  pullNumber: 1,
  headSha: 'a'.repeat(40),
  policyFingerprint: 'policy',
  batches: [{ index: 0, files: ['a.ts'], completed: false, findings: 0 }],
}

test('a partial-file batch cannot replace or omit its context-pack identities', () => {
  const manifest = { ...state, batches: [{ ...state.batches[0], packIds: ['pack-1'] }] }
  const review = artifact()
  assert.equal(validateCanary(manifest, review).ready, false)
  review.batch.packIds = ['pack-1']
  review.review.evidence.contextPacks = [{ id: 'pack-2' }]
  assert.equal(validateCanary(manifest, review).ready, false)
  review.review.evidence.contextPacks = [{ id: 'pack-1' }]
  assert.equal(validateCanary(manifest, review).ready, true)
})

function artifact(overrides = {}) {
  return {
    version: 1,
    repository: state.repository,
    pullNumber: state.pullNumber,
    headSha: state.headSha,
    policyFingerprint: state.policyFingerprint,
    batch: { index: 0, files: ['a.ts'] },
    review: {
      verdict: 'APPROVE', blocking: false, incomplete: false, findings: [], dropped: [], unreviewed: [],
      execution: { attempted: 1, succeeded: 1, failed: 0 },
      evidence: { profile: 'full', providerCalls: 1, failedProviderCalls: 0, skippedProviderCalls: 0, elapsedMs: 1, deadlineMs: 10, deadlineExceeded: false, circuitState: 'closed' },
      summary: 'ok',
    },
    ...overrides,
  }
}

test('blocker sweep returns every failed check in deterministic order', () => {
  const report = runBlockerSweep([{ id: 'z', ok: false, detail: 'z' }, { id: 'a', ok: false, detail: 'a' }, { id: 'ok', ok: true, detail: 'ok' }])
  assert.equal(report.status, 'blocked')
  assert.deepEqual(report.blockers.map(({ id }) => id), ['a', 'z'])
})

test('canary accepts complete evidence and rejects stale identity', () => {
  assert.equal(validateCanary(state, artifact()).ready, true)
  assert.equal(validateCanary(state, artifact({ policyFingerprint: 'stale' })).ready, false)
})

test('canary rejects incomplete profile or required lenses', () => {
  const review = artifact().review
  const result = validateCanary(state, artifact({ review: { ...review, evidence: { ...review.evidence, profile: 'fast' }, missingRequiredLenses: ['security'] } }))
  assert.deepEqual(result.blockers.map(({ id }) => id), ['review.lenses', 'review.profile'])
})

test('harness contract fingerprints are deterministic', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }))
  const contract = createHarnessContract({ runId: 'run-1', sourceSha: state.headSha, config: { a: 1 }, manifest: state, createdAt: '2026-01-01T00:00:00Z' })
  assert.equal(contract.version, 1)
  assert.match(contract.configFingerprint, /^[a-f0-9]{64}$/)
})

test('run state fails closed, retries canary twice, and resumes batches idempotently', () => {
  const initial = createHarnessRun({ runId: 'run-1', batchIndices: [2, 0, 1] })
  const blockedCanary = { ready: false, blockers: [{ id: 'identity.sha', ok: false, detail: 'stale', severity: 'blocker' }], artifact: artifact() }
  const retry = recordCanaryAttempt(initial, blockedCanary)
  assert.equal(retry.stage, 'canary')
  const blocked = recordCanaryAttempt(retry, blockedCanary)
  assert.equal(blocked.stage, 'blocked')
  const ready = recordCanaryAttempt(retry, { ...blockedCanary, ready: true, blockers: [] })
  assert.equal(ready.stage, 'full-review')
  const afterFirst = recordBatchCompletion(ready, 0)
  assert.deepEqual(afterFirst.pendingBatches, [1, 2])
  const afterRestart = { ...afterFirst, completedBatches: [...afterFirst.completedBatches] }
  assert.equal(recordBatchCompletion(afterRestart, 1).pendingBatches.length, 1)
  assert.throws(() => recordBatchCompletion(afterRestart, 0), /not pending/)
})
