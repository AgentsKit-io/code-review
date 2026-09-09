import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createReviewFeedbackStore } from '../dist/src/review-stores.js'
import { createReviewReconciliationStore, reconcileReviewFeedback } from '../dist/src/review-feedback.js'

const run = async (fn) => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-review-feedback-'))
  try { await fn(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

const append = (store, pullNumber, status, title = 'Use the audited sender.') => store.append({
  runId: `run-${pullNumber}-${status}`,
  repository: 'AgentsKit-io/agentskit-os',
  pullNumber,
  headSha: `sha-${pullNumber}`,
  finding: { file: 'src/send.ts', line: 12, title, status },
  createdAt: new Date(2026, 0, pullNumber).toISOString(),
})

test('reconciliation represents every outcome and is idempotent', async () => run(async (directory) => {
  const store = createReviewFeedbackStore(join(directory, 'feedback.json'))
  const entries = await Promise.all([
    append(store, 1, 'accepted'), append(store, 2, 'fixed'), append(store, 3, 'rejected'),
    append(store, 4, 'unresolved'), append(store, 5, 'obsolete'), append(store, 6, 'pending'),
  ])
  const report = reconcileReviewFeedback(entries)
  assert.deepEqual(report.metrics.outcomeCounts, { accepted: 1, rejected: 1, fixed: 1, unresolved: 1, obsolete: 1, pending: 1 })
  assert.equal(report.metrics.candidateCount, 1)
  assert.equal(report.candidates[0].active, false)
  assert.equal(report.candidates[0].requiresApproval, true)
  const resumed = reconcileReviewFeedback(entries, report)
  assert.deepEqual({ ...resumed, updatedAt: report.updatedAt }, report)
}))

test('candidate evidence is resumable and never activates knowledge', async () => run(async (directory) => {
  const feedback = createReviewFeedbackStore(join(directory, 'feedback.json'))
  const checkpoint = createReviewReconciliationStore(join(directory, 'state', 'reconciliation.json'))
  const first = await append(feedback, 10, 'accepted')
  const initial = reconcileReviewFeedback([first])
  await checkpoint.save(initial)
  const second = await append(feedback, 11, 'fixed')
  const resumed = reconcileReviewFeedback(await feedback.load(), await checkpoint.load())
  assert.equal(resumed.metrics.processedFeedbackEntries, 2)
  assert.equal(resumed.metrics.supportingEvidence, 2)
  assert.equal(resumed.candidates.length, 1)
  assert.equal(resumed.candidates[0].evidence.length, 2)
  assert.equal(resumed.metrics.activeRulesCreated, 0)
  assert.equal(second.finding.title, resumed.candidates[0].rule)
}))

test('malformed reconciliation checkpoints fail closed', async () => run(async (directory) => {
  const path = join(directory, 'reconciliation.json')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, JSON.stringify({ version: 99 }))
  await assert.rejects(createReviewReconciliationStore(path).load(), /reconciliation checkpoint is malformed/)
}))
