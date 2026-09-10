import assert from 'node:assert/strict'
import test from 'node:test'
import { compareQuality, evaluateCampaignQuality, evaluateQuality, evaluateQualityAgainstBaseline } from '../dist/src/quality-matrix.js'

const complete = (overrides = {}) => ({
  runId: 'fixture-run', version: '0.6.0', sourceRevision: 'fixture-sha',
  evidence: { kind: 'synthetic', fixtureId: 'quality-matrix' },
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
  assert.ok(comparison.materialRegressions.some((entry) => entry.area === 'detection'))
})

test('campaign matrices require every discovered pull request to reach a terminal quality result', () => {
  const report = evaluateCampaignQuality({
    evidence: { kind: 'real-campaign', campaignId: 'campaign-1' },
    campaign: { discovered: 2, terminal: 1, completed: 1, partial: 0, blocked: 0, skipped: 0, cancelled: 0, qualityReports: 1, retries: 0, wastedCalls: 0, wallClockMs: 100 },
    pullRequestReports: [evaluateQuality(complete())],
  })
  assert.equal(report.decision, 'BLOCKED')
  assert.equal(report.absoluteGates.find((gate) => gate.name === 'campaign-terminal-coverage')?.passed, false)
  assert.equal(report.evidence?.kind, 'real-campaign')
})

test('eligible completed reviews and intentionally skipped PRs form a complete campaign', () => {
  const input = {
    evidence: { kind: 'real-campaign', campaignId: 'skipped-campaign' },
    campaign: { discovered: 6, terminal: 6, completed: 1, partial: 0, blocked: 0, skipped: 5, cancelled: 0, qualityReports: 1, retries: 0, wastedCalls: 0, wallClockMs: 100 },
    pullRequestReports: [evaluateQuality(complete())],
  }
  assert.equal(evaluateCampaignQuality(input).decision, 'PASS')
  assert.equal(evaluateCampaignQuality({ ...input, campaign: { ...input.campaign, skipped: 4, blocked: 1 } }).decision, 'BLOCKED')
})

test('retries, wasted calls, wall clock, and reported token classes participate in scores', () => {
  const base = complete({
    performance: { p95Ms: 1000, baselineP95Ms: 1000, wallClockMs: 1000, baselineWallClockMs: 1000 },
    tokens: { changedLines: 100, validFindings: 4, baselineTokensPerChangedLine: 45, accounting: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100, reasoningOutputTokens: 100, memoryTokens: 100, retryTokens: 0, total: 1400 } },
    batches: { planned: 10, completed: 10, retried: 0, wastedCalls: 0, providerCalls: 10, baselineProviderCalls: 10, overBudget: 0 },
  })
  const degraded = evaluateQuality({ ...base, performance: { ...base.performance, wallClockMs: 1600 }, tokens: { ...base.tokens, accounting: { ...base.tokens.accounting, retryTokens: 300, total: 1700 } }, batches: { ...base.batches, retried: 2, wastedCalls: 2 } })
  assert.equal(degraded.areas.find((area) => area.area === 'speed')?.score, 1)
  assert.equal(degraded.areas.find((area) => area.area === 'batch-efficiency')?.score, 2)
  assert.ok((degraded.areas.find((area) => area.area === 'token-efficiency')?.metrics.tokensUsed ?? 0) > 1400)
})

test('provider retry efficiency uses provider calls, not file-batch count', () => {
  const report = evaluateQuality(complete({ batches: { planned: 2, completed: 2, retried: 0, wastedCalls: 1, providerCalls: 28, overBudget: 0 } }))
  assert.equal(report.areas.find(area => area.area === 'batch-efficiency').score, 3)
})

test('a material baseline regression blocks the release decision', () => {
  const baseline = evaluateQuality(complete())
  const report = evaluateQualityAgainstBaseline(complete({ findings: { ...complete().findings, detectedExpected: 2 } }), baseline)
  assert.equal(report.decision, 'BLOCKED')
  assert.equal(report.absoluteGates.find((gate) => gate.name === 'no-material-regressions')?.passed, false)
})

test('a one-point score jitter remains compatible with the minimum quality floor', () => {
  const baseline = evaluateQuality(complete())
  const report = evaluateQualityAgainstBaseline(complete({ performance: { p95Ms: 1249, baselineP95Ms: 1100 } }), baseline)
  assert.equal(report.decision, 'PASS')
  assert.deepEqual(report.absoluteGates.find((gate) => gate.name === 'no-material-regressions'), {
    name: 'no-material-regressions', passed: true, detail: 'no configured material quality regression',
  })
})

test('small PRs use provider-call token efficiency when changed-line baselines are not comparable', () => {
  const report = evaluateQuality(complete({
    tokens: { tokensUsed: 67752, changedLines: 10, validFindings: 2, baselineChangedLines: 2825, baselineTokensPerChangedLine: 461.2959, baselineTokensPerProviderCall: 23693 },
    batches: { planned: 2, completed: 2, retried: 0, overBudget: 0, providerCalls: 3 },
  }))
  const area = report.areas.find((candidate) => candidate.area === 'token-efficiency')
  assert.equal(area?.score, 4)
  assert.equal(area?.metrics.comparisonBasis, 'provider-call')
})
