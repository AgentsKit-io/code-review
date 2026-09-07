import assert from 'node:assert/strict'
import test from 'node:test'
import { compareQuality, evaluateQuality } from '../dist/src/quality-matrix.js'

const complete = (overrides = {}) => ({
  runId: 'fixture-run', version: '0.6.0', sourceRevision: 'fixture-sha',
  coverage: { eligibleFiles: 10, reviewedFiles: 10, unreviewedFiles: 0, requiredLensRuns: 30, completedRequiredLensRuns: 30 },
  findings: { expected: 4, detectedExpected: 4, falsePositives: 0, duplicates: 0, severityMatches: 4, severityTotal: 4, actionable: 4, detected: 4 },
  comments: { inlineExpected: 4, inlineValid: 4, actionable: 4, total: 4 },
  security: { secretLeaks: 0, unsafeActions: 0, failClosedViolations: 0 },
  reliability: { runs: 10, completeRuns: 10, incompleteAccepted: 0, staleArtifactsAccepted: 0, silentFailures: 0 },
  performance: { p95Ms: 1000, baselineP95Ms: 1100 },
  tokens: { tokensUsed: 4000, changedLines: 100, validFindings: 4, baselineTokensPerFinding: 1200 },
  batches: { planned: 3, completed: 3, retried: 0, overBudget: 0 },
  memory: { enabled: true, persistencePass: true, loadPass: true, malformedRejected: true, feedbackRecorded: true, rulesApproved: true },
  configuration: { validAccepted: true, invalidRejected: true, schemaAvailable: true },
  integration: { githubPass: true, orcaPass: true, releasePass: true, mergeSafetyPass: true },
  ...overrides,
})

test('quality matrix passes only when every area is measured at least three', () => {
  const report = evaluateQuality(complete())
  assert.equal(report.decision, 'PASS')
  assert.ok(report.areas.every((area) => area.score >= 3))
  assert.ok(report.absoluteGates.every((gate) => gate.passed))
})

test('quality matrix blocks incomplete coverage and absolute safety violations', () => {
  const report = evaluateQuality(complete({ coverage: { eligibleFiles: 10, reviewedFiles: 9, unreviewedFiles: 1, requiredLensRuns: 30, completedRequiredLensRuns: 27 }, security: { secretLeaks: 1, unsafeActions: 0, failClosedViolations: 0 } }))
  assert.equal(report.decision, 'BLOCKED')
  assert.equal(report.areas.find((area) => area.area === 'coverage')?.score, 3)
  assert.equal(report.absoluteGates.find((gate) => gate.name === 'no-secret-leaks')?.passed, false)
})

test('quality comparison reports regressions and improvements by area', () => {
  const baseline = evaluateQuality(complete())
  const current = evaluateQuality(complete({ findings: { expected: 4, detectedExpected: 3, falsePositives: 1, duplicates: 0, severityMatches: 3, severityTotal: 4, actionable: 3, detected: 4 } }))
  const comparison = compareQuality(current, baseline)
  assert.ok(comparison.regressions.some((entry) => entry.area === 'detection'))
  assert.ok(comparison.regressions.some((entry) => entry.area === 'precision'))
})
