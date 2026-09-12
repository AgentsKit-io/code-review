import assert from 'node:assert/strict'
import test from 'node:test'
import { consolidateBatchArtifacts, consolidateToArtifact, createBatchCoverage, describeCoverage, finalCoverage, partitionReviewableFiles, publicationDecision, recordBatch } from '../dist/src/batch-coverage.js'

test('batch coverage rejects stale SHA and completes only after every batch', () => {
  const state = createBatchCoverage({ repository: 'AgentsKit-io/agentskit-os', pullNumber: 1, headSha: 'a'.repeat(40), policyFingerprint: 'policy', batches: [{ index: 0, files: ['a.ts'] }, { index: 1, files: ['b.ts'] }] })
  assert.deepEqual(finalCoverage(state), { complete: false, findings: 0, pending: [0, 1], totalFiles: 2, reviewedFiles: 0 })
  assert.equal(publicationDecision(state).publish, false)
  assert.throws(() => recordBatch(state, { headSha: 'b'.repeat(40), policyFingerprint: 'policy', index: 0, findings: 0 }), /stale/)
  const first = recordBatch(state, { headSha: 'a'.repeat(40), policyFingerprint: 'policy', index: 0, findings: 1 })
  assert.deepEqual(finalCoverage(first), { complete: false, findings: 1, pending: [1], totalFiles: 2, reviewedFiles: 1 })
  assert.deepEqual(finalCoverage(recordBatch(first, { headSha: 'a'.repeat(40), policyFingerprint: 'policy', index: 1, findings: 0 })), { complete: true, findings: 1, pending: [], totalFiles: 2, reviewedFiles: 2 })
})

test('describeCoverage reports N of M files reviewed instead of only a boolean', () => {
  const state = createBatchCoverage({ repository: 'AgentsKit-io/agentskit-os', pullNumber: 1, headSha: 'a'.repeat(40), policyFingerprint: 'policy', batches: [{ index: 0, files: ['a.ts'] }, { index: 1, files: ['b.ts'] }] })
  assert.equal(describeCoverage(state), '0 of 2 file(s) reviewed; 2 batch(es) pending: 0, 1')
  const first = recordBatch(state, { headSha: 'a'.repeat(40), policyFingerprint: 'policy', index: 0, findings: 1 })
  assert.equal(describeCoverage(first), '1 of 2 file(s) reviewed; 1 batch(es) pending: 1')
  const done = recordBatch(first, { headSha: 'a'.repeat(40), policyFingerprint: 'policy', index: 1, findings: 0 })
  assert.equal(describeCoverage(done), '2 of 2 file(s) reviewed (complete)')
})

test('file partitioning is deterministic', () => {
  assert.deepEqual(partitionReviewableFiles(['b.ts', 'a.ts', 'b.ts'], 1), [{ index: 0, files: ['a.ts'] }, { index: 1, files: ['b.ts'] }])
})

test('only complete, matching batch artifacts can become a publishable review', () => {
  const state = createBatchCoverage({ repository: 'AgentsKit-io/agentskit-os', pullNumber: 1, headSha: 'a'.repeat(40), policyFingerprint: 'policy', batches: [{ index: 0, files: ['a.ts'] }, { index: 1, files: ['b.ts'] }] })
  const review = (findings = []) => ({ verdict: findings.length ? 'COMMENT' : 'APPROVE', blocking: false, incomplete: true, findings, dropped: [], execution: { attempted: 1, succeeded: 1, failed: 0 }, evidence: { profile: 'full', providerCalls: 1, failedProviderCalls: 0, skippedProviderCalls: 0, elapsedMs: 1, deadlineMs: 10, deadlineExceeded: false, circuitState: 'closed' }, summary: 'batch' })
  const artifact = (index, files, findings = []) => ({ version: 1, repository: state.repository, pullNumber: state.pullNumber, headSha: state.headSha, policyFingerprint: state.policyFingerprint, batch: { index, files }, review: review(findings) })
  assert.throws(() => consolidateBatchArtifacts(state, [artifact(0, ['a.ts'])]), /coverage incomplete/)
  const combined = consolidateBatchArtifacts(state, [artifact(0, ['a.ts']), artifact(1, ['b.ts'])])
  assert.equal(combined.incomplete, false)
  assert.equal(combined.verdict, 'APPROVE')
  assert.deepEqual(combined.coverage, { totalFiles: 2, reviewedFiles: 2, unreviewedFiles: 0 })
  const publishable = consolidateToArtifact(state, [artifact(0, ['a.ts']), artifact(1, ['b.ts'])])
  assert.deepEqual({ repository: publishable.repository, pullNumber: publishable.pullNumber, headSha: publishable.headSha, policyFingerprint: publishable.policyFingerprint, incomplete: publishable.review.incomplete }, { repository: state.repository, pullNumber: state.pullNumber, headSha: state.headSha, policyFingerprint: state.policyFingerprint, incomplete: false })
  assert.throws(() => consolidateBatchArtifacts(state, [artifact(0, ['wrong.ts']), artifact(1, ['b.ts'])]), /manifest/)
})

test('consolidation preserves provider token evidence only when every batch reports it', () => {
  const state = createBatchCoverage({ repository: 'owner/repo', pullNumber: 1, headSha: 'a'.repeat(40), policyFingerprint: 'policy', batches: [{ index: 0, files: ['a.ts'] }, { index: 1, files: ['b.ts'] }] })
  const artifact = (index, tokensUsed) => ({ version: 1, repository: state.repository, pullNumber: 1, headSha: state.headSha, policyFingerprint: state.policyFingerprint, batch: { index, files: [`${index ? 'b' : 'a'}.ts`] }, review: { verdict: 'APPROVE', blocking: false, incomplete: false, findings: [], dropped: [], execution: { attempted: 1, succeeded: 1, failed: 0 }, evidence: { profile: 'full', providerCalls: 1, failedProviderCalls: 0, skippedProviderCalls: 0, elapsedMs: 1, deadlineMs: 10, deadlineExceeded: false, circuitState: 'closed', ...(tokensUsed === undefined ? {} : { tokensUsed }) }, summary: 'ok' } })
  assert.equal(consolidateBatchArtifacts(state, [artifact(0, 10), artifact(1, 20)]).evidence.tokensUsed, 30)
  assert.equal(consolidateBatchArtifacts(state, [artifact(0, 10), artifact(1)]).evidence.tokensUsed, undefined)
})

test('consolidation preserves context-pack risk evidence from every batch', () => {
  const state = createBatchCoverage({ repository: 'owner/repo', pullNumber: 1, headSha: 'a'.repeat(40), policyFingerprint: 'b'.repeat(64), batches: [{ index: 0, files: ['a.ts'] }, { index: 1, files: ['b.ts'] }] })
  const risk = (level) => ({ id: `pack-${level}`, files: [`${level}.ts`], estimatedTokens: 10, tokenBudget: 100, reserveForOutput: 10, risk: { level, signals: [], specializedCategories: [] }, expansion: [] })
  const evidence = { profile: 'full', providerCalls: 1, failedProviderCalls: 0, skippedProviderCalls: 0, elapsedMs: 1, deadlineMs: 10, deadlineExceeded: false, circuitState: 'closed' }
  const artifacts = [0, 1].map((index) => ({
    version: 1, repository: state.repository, pullNumber: 1, headSha: state.headSha, policyFingerprint: state.policyFingerprint,
    batch: { index, files: [`${index ? 'b' : 'a'}.ts`] },
    review: { verdict: 'APPROVE', blocking: false, incomplete: false, findings: [], dropped: [], execution: { attempted: 1, succeeded: 1, failed: 0 }, evidence: { ...evidence, contextPacks: [risk(index ? 'normal' : 'low')] }, summary: 'ok' },
  }))
  assert.deepEqual(consolidateBatchArtifacts(state, artifacts).evidence.contextPacks?.map((pack) => pack.risk.level), ['low', 'normal'])
})
