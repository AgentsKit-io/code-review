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
  tokens: { tokensUsed: 4000, changedLines: 100, validFindings: 4, baselineTokensPerChangedLine: 45 },
  batches: { planned: 3, completed: 3, retried: 0, overBudget: 0 },
  memory: { enabled: true, persistencePass: true, loadPass: true, malformedRejected: true, feedbackRecorded: true, rulesApproved: true, learningEvaluationPass: true, learningDetectionLift: true, learningPrecisionPass: true, learningTokenPass: true },
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

test('disabled memory is explicitly not applicable instead of an unmeasured failure', () => {
  const report = evaluateQuality(complete({ memory: { ...complete().memory, enabled: false } }))
  assert.equal(report.decision, 'PASS')
  assert.equal(report.areas.find((area) => area.area === 'memory-learning')?.status, 'not-applicable')
})

test('quality matrix blocks incomplete coverage and absolute safety violations', () => {
  const report = evaluateQuality(complete({ coverage: { eligibleFiles: 10, reviewedFiles: 9, unreviewedFiles: 1, requiredLensRuns: 30, completedRequiredLensRuns: 27 }, security: { secretLeaks: 1, unsafeActions: 0, failClosedViolations: 0 } }))
  assert.equal(report.decision, 'BLOCKED')
  assert.equal(report.areas.find((area) => area.area === 'coverage')?.score, 3)
  assert.equal(report.absoluteGates.find((gate) => gate.name === 'no-secret-leaks')?.passed, false)
  assert.equal(report.absoluteGates.find((gate) => gate.name === 'complete-file-coverage')?.passed, false)
})

test('severity accepts an adjacent classification at the minimum passing score', () => {
  const report = evaluateQuality(complete({ findings: { ...complete().findings, severityMatches: 0, severityWithinOne: 4 } }))
  assert.equal(report.areas.find((area) => area.area === 'severity')?.score, 3)
})

test('speed tolerates ordinary provider latency jitter without hiding a regression', () => {
  const passing = evaluateQuality(complete({ performance: { p95Ms: 1249, baselineP95Ms: 1000 } }))
  const failing = evaluateQuality(complete({ performance: { p95Ms: 1501, baselineP95Ms: 1000 } }))
  assert.equal(passing.areas.find((area) => area.area === 'speed')?.score, 3)
  assert.equal(failing.areas.find((area) => area.area === 'speed')?.score, 1)
})

test('memory cannot pass without a measured A/B learning lift', () => {
  const report = evaluateQuality(complete({ memory: { ...complete().memory, learningEvaluationPass: false, learningDetectionLift: false } }))
  assert.equal(report.decision, 'BLOCKED')
  assert.equal(report.areas.find((area) => area.area === 'memory-learning')?.score, 1)
})

test('quality comparison reports regressions and improvements by area', () => {
  const baseline = evaluateQuality(complete())
  const current = evaluateQuality(complete({ findings: { expected: 4, detectedExpected: 3, falsePositives: 1, duplicates: 0, severityMatches: 3, severityTotal: 4, actionable: 3, detected: 4 } }))
  const comparison = compareQuality(current, baseline)
  assert.ok(comparison.regressions.some((entry) => entry.area === 'detection'))
  assert.ok(comparison.regressions.some((entry) => entry.area === 'precision'))
})
