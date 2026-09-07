export const QUALITY_AREAS = [
  'coverage', 'detection', 'precision', 'severity', 'actionability', 'comments',
  'security', 'reliability', 'speed', 'token-efficiency', 'batch-efficiency',
  'memory-learning', 'configuration', 'integration',
] as const

export type QualityArea = typeof QUALITY_AREAS[number]
export type QualityStatus = 'passed' | 'failed' | 'not-measured'

export interface QualityInput {
  runId?: string
  version?: string
  sourceRevision?: string
  coverage: { eligibleFiles: number; reviewedFiles: number; unreviewedFiles: number; requiredLensRuns: number; completedRequiredLensRuns: number }
  findings: { expected: number; detectedExpected: number; falsePositives: number; duplicates: number; severityMatches: number; severityTotal: number; actionable: number; detected: number }
  comments: { inlineExpected: number; inlineValid: number; actionable: number; total: number }
  security: { secretLeaks: number; unsafeActions: number; failClosedViolations: number }
  reliability: { runs: number; completeRuns: number; incompleteAccepted: number; staleArtifactsAccepted: number; silentFailures: number }
  performance: { p95Ms: number; baselineP95Ms?: number }
  tokens: { tokensUsed?: number; changedLines: number; validFindings: number; baselineTokensPerFinding?: number }
  batches: { planned: number; completed: number; retried: number; overBudget: number }
  memory: { enabled: boolean; persistencePass: boolean; loadPass: boolean; malformedRejected: boolean; feedbackRecorded: boolean; rulesApproved: boolean }
  configuration: { validAccepted: boolean; invalidRejected: boolean; schemaAvailable: boolean; requiredFlags?: number }
  integration: { githubPass: boolean; orcaPass: boolean; releasePass: boolean; mergeSafetyPass: boolean }
}

export interface QualityAreaResult {
  area: QualityArea
  score: number | null
  status: QualityStatus
  metrics: Record<string, number | boolean | string>
  reason: string
}

export interface QualityReport {
  version: 1
  runId?: string
  libraryVersion?: string
  sourceRevision?: string
  minimumScore: 3
  decision: 'PASS' | 'BLOCKED'
  areas: QualityAreaResult[]
  absoluteGates: { name: string; passed: boolean; detail: string }[]
}

function ratioScore(numerator: number, denominator: number): number | null {
  if (denominator < 0 || numerator < 0 || numerator > denominator) throw new Error('quality metric ratio is invalid')
  if (denominator === 0) return null
  const ratio = numerator / denominator
  return ratio >= 1 ? 4 : ratio >= 0.9 ? 3 : ratio >= 0.75 ? 2 : 1
}

function zeroScore(value: number): number { return value === 0 ? 4 : 1 }
function booleanScore(value: boolean): number { return value ? 4 : 1 }
function minimum(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null)
  return measured.length ? Math.min(...measured) : null
}

function result(area: QualityArea, score: number | null, metrics: Record<string, number | boolean | string>, reason: string): QualityAreaResult {
  return { area, score, status: score === null ? 'not-measured' : score >= 3 ? 'passed' : 'failed', metrics, reason }
}

export function evaluateQuality(input: QualityInput): QualityReport {
  const coverage = minimum([
    ratioScore(input.coverage.reviewedFiles, input.coverage.eligibleFiles),
    ratioScore(input.coverage.completedRequiredLensRuns, input.coverage.requiredLensRuns),
  ])
  const detection = minimum([
    ratioScore(input.findings.detectedExpected, input.findings.expected),
    ratioScore(input.findings.detectedExpected, input.findings.detected),
  ])
  const precision = ratioScore(Math.max(0, input.findings.detected - input.findings.falsePositives - input.findings.duplicates), input.findings.detected)
  const severity = ratioScore(input.findings.severityMatches, input.findings.severityTotal)
  const actionability = minimum([
    ratioScore(input.findings.actionable, input.findings.detected),
    ratioScore(input.comments.actionable, input.comments.total),
  ])
  const comments = minimum([
    ratioScore(input.comments.inlineValid, input.comments.inlineExpected),
    ratioScore(input.comments.actionable, input.comments.total),
  ])
  const security = minimum([zeroScore(input.security.secretLeaks), zeroScore(input.security.unsafeActions), zeroScore(input.security.failClosedViolations)])
  const reliability = minimum([
    ratioScore(input.reliability.completeRuns, input.reliability.runs),
    zeroScore(input.reliability.incompleteAccepted),
    zeroScore(input.reliability.staleArtifactsAccepted),
    zeroScore(input.reliability.silentFailures),
  ])
  const speed = input.performance.baselineP95Ms === undefined || input.performance.baselineP95Ms <= 0
    ? null
    : input.performance.p95Ms <= input.performance.baselineP95Ms ? 4 : input.performance.p95Ms <= input.performance.baselineP95Ms * 1.1 ? 3 : input.performance.p95Ms <= input.performance.baselineP95Ms * 1.25 ? 2 : 1
  const tokensPerFinding = input.tokens.tokensUsed === undefined || input.tokens.validFindings === 0 ? null : input.tokens.tokensUsed / input.tokens.validFindings
  const tokenEfficiency = input.tokens.baselineTokensPerFinding === undefined || tokensPerFinding === null
    ? null
    : tokensPerFinding <= input.tokens.baselineTokensPerFinding ? 4 : tokensPerFinding <= input.tokens.baselineTokensPerFinding * 1.1 ? 3 : input.tokens.baselineTokensPerFinding * 1.25 >= tokensPerFinding ? 2 : 1
  const batchEfficiency = minimum([
    ratioScore(input.batches.completed, input.batches.planned),
    zeroScore(input.batches.overBudget),
  ])
  const memoryLearning = input.memory.enabled
    ? minimum([booleanScore(input.memory.persistencePass), booleanScore(input.memory.loadPass), booleanScore(input.memory.malformedRejected), booleanScore(input.memory.feedbackRecorded), booleanScore(input.memory.rulesApproved)])
    : null
  const configuration = minimum([booleanScore(input.configuration.validAccepted), booleanScore(input.configuration.invalidRejected), booleanScore(input.configuration.schemaAvailable)])
  const integration = minimum([booleanScore(input.integration.githubPass), booleanScore(input.integration.orcaPass), booleanScore(input.integration.releasePass), booleanScore(input.integration.mergeSafetyPass)])
  const areas: QualityAreaResult[] = [
    result('coverage', coverage, { reviewedFiles: input.coverage.reviewedFiles, eligibleFiles: input.coverage.eligibleFiles, unreviewedFiles: input.coverage.unreviewedFiles }, 'All eligible files and required lenses must be covered.'),
    result('detection', detection, { expected: input.findings.expected, detectedExpected: input.findings.detectedExpected, detected: input.findings.detected }, 'Known findings must be detected without treating absence of ground truth as success.'),
    result('precision', precision, { detected: input.findings.detected, falsePositives: input.findings.falsePositives, duplicates: input.findings.duplicates }, 'False positives and duplicate findings reduce precision.'),
    result('severity', severity, { severityMatches: input.findings.severityMatches, severityTotal: input.findings.severityTotal }, 'Reported severity must match the reference classification.'),
    result('actionability', actionability, { actionableFindings: input.findings.actionable, detected: input.findings.detected }, 'Findings must tell an agent why, what to change, and how to verify it.'),
    result('comments', comments, { inlineValid: input.comments.inlineValid, inlineExpected: input.comments.inlineExpected }, 'Inline locations and actionable comment structure must remain valid.'),
    result('security', security, { secretLeaks: input.security.secretLeaks, unsafeActions: input.security.unsafeActions, failClosedViolations: input.security.failClosedViolations }, 'Security and fail-closed violations are absolute defects.'),
    result('reliability', reliability, { completeRuns: input.reliability.completeRuns, runs: input.reliability.runs, staleArtifactsAccepted: input.reliability.staleArtifactsAccepted }, 'Incomplete, stale, or silently failed work cannot be accepted.'),
    result('speed', speed, { p95Ms: input.performance.p95Ms, baselineP95Ms: input.performance.baselineP95Ms ?? 'missing' }, 'Speed is relative to a measured baseline.'),
    result('token-efficiency', tokenEfficiency, { tokensUsed: input.tokens.tokensUsed ?? 'missing', tokensPerFinding: tokensPerFinding ?? 'missing' }, 'Token efficiency is relative to a measured baseline.'),
    result('batch-efficiency', batchEfficiency, { planned: input.batches.planned, completed: input.batches.completed, overBudget: input.batches.overBudget }, 'Batches must complete within budget without avoidable retries.'),
    result('memory-learning', memoryLearning, { enabled: input.memory.enabled, feedbackRecorded: input.memory.feedbackRecorded, rulesApproved: input.memory.rulesApproved }, 'Memory and learning require explicit evidence; disabled memory is not silently scored.'),
    result('configuration', configuration, { validAccepted: input.configuration.validAccepted, invalidRejected: input.configuration.invalidRejected, schemaAvailable: input.configuration.schemaAvailable }, 'The public configuration must validate before execution.'),
    result('integration', integration, { githubPass: input.integration.githubPass, orcaPass: input.integration.orcaPass, releasePass: input.integration.releasePass, mergeSafetyPass: input.integration.mergeSafetyPass }, 'External integration evidence must be explicit.'),
  ]
  const absoluteGates = [
    { name: 'complete-file-coverage', passed: input.coverage.unreviewedFiles === 0 && input.coverage.reviewedFiles === input.coverage.eligibleFiles, detail: `${input.coverage.unreviewedFiles} unreviewed file(s)` },
    { name: 'no-secret-leaks', passed: input.security.secretLeaks === 0, detail: `${input.security.secretLeaks} secret leak(s)` },
    { name: 'no-unsafe-actions', passed: input.security.unsafeActions === 0 && input.security.failClosedViolations === 0, detail: `${input.security.unsafeActions + input.security.failClosedViolations} unsafe/fail-open event(s)` },
    { name: 'no-stale-acceptance', passed: input.reliability.staleArtifactsAccepted === 0, detail: `${input.reliability.staleArtifactsAccepted} stale artifact(s) accepted` },
    { name: 'no-incomplete-acceptance', passed: input.reliability.incompleteAccepted === 0, detail: `${input.reliability.incompleteAccepted} incomplete run(s) accepted` },
    { name: 'no-invalid-inline-comments', passed: input.comments.inlineValid === input.comments.inlineExpected, detail: `${input.comments.inlineExpected - input.comments.inlineValid} invalid inline comment(s)` },
    { name: 'no-silent-failures', passed: input.reliability.silentFailures === 0, detail: `${input.reliability.silentFailures} silent failure(s)` },
  ]
  return { version: 1, runId: input.runId, libraryVersion: input.version, sourceRevision: input.sourceRevision, minimumScore: 3, decision: areas.every((area) => area.score !== null && area.score >= 3) && absoluteGates.every((gate) => gate.passed) ? 'PASS' : 'BLOCKED', areas, absoluteGates }
}

export function compareQuality(current: QualityReport, baseline: QualityReport): { regressions: { area: QualityArea; from: number | null; to: number | null }[]; improved: QualityArea[] } {
  const regressions: { area: QualityArea; from: number | null; to: number | null }[] = []
  const improved: QualityArea[] = []
  for (const area of current.areas) {
    const before = baseline.areas.find((candidate) => candidate.area === area.area)?.score ?? null
    if (before !== null && area.score !== null && area.score < before) regressions.push({ area: area.area, from: before, to: area.score })
    if (before !== null && area.score !== null && area.score > before) improved.push(area.area)
  }
  return { regressions, improved }
}
