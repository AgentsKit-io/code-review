export const QUALITY_AREAS = [
  'coverage', 'detection', 'precision', 'severity', 'actionability', 'comments',
  'security', 'reliability', 'speed', 'token-efficiency', 'batch-efficiency',
  'memory-learning', 'configuration', 'integration',
] as const

export type QualityArea = typeof QUALITY_AREAS[number]
export type QualityStatus = 'passed' | 'failed' | 'not-measured' | 'not-applicable'

export interface QualityInput {
  runId?: string
  version?: string
  sourceRevision?: string
  coverage: { eligibleFiles: number; reviewedFiles: number; unreviewedFiles: number; requiredLensRuns: number; completedRequiredLensRuns: number }
  findings: { expected: number; detectedExpected: number; falsePositives: number; duplicates: number; severityMatches: number; severityWithinOne?: number; severityTotal: number; actionable: number; detected: number }
  comments: { inlineExpected: number; inlineValid: number; actionable: number; total: number }
  security: { secretLeaks: number; unsafeActions: number; failClosedViolations: number }
  reliability: { runs: number; completeRuns: number; incompleteAccepted: number; staleArtifactsAccepted: number; silentFailures: number }
  performance: { p95Ms: number; baselineP95Ms?: number }
  tokens: { tokensUsed?: number; changedLines: number; validFindings: number; baselineTokensPerChangedLine?: number }
  batches: { planned: number; completed: number; retried: number; overBudget: number }
  memory: { enabled: boolean; persistencePass: boolean; loadPass: boolean; malformedRejected: boolean; feedbackRecorded: boolean; rulesApproved: boolean; learningEvaluationPass: boolean; learningDetectionLift: boolean; learningPrecisionPass: boolean; learningTokenPass: boolean }
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
  inputError?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  return value
}

const requireNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${path} must be a finite non-negative number`)
  return value
}

const requireBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

const requireNumbers = (value: unknown, path: string, keys: readonly string[]): void => {
  const record = requireRecord(value, path)
  for (const key of keys) requireNumber(record[key], `${path}.${key}`)
}

const requireBooleans = (value: unknown, path: string, keys: readonly string[]): void => {
  const record = requireRecord(value, path)
  for (const key of keys) requireBoolean(record[key], `${path}.${key}`)
}

/** Validate and narrow JSON received from an external runner before scoring it. */
export function parseQualityInput(value: unknown): QualityInput {
  const input = requireRecord(value, 'input')
  requireNumbers(input.coverage, 'coverage', ['eligibleFiles', 'reviewedFiles', 'unreviewedFiles', 'requiredLensRuns', 'completedRequiredLensRuns'])
  requireNumbers(input.findings, 'findings', ['expected', 'detectedExpected', 'falsePositives', 'duplicates', 'severityMatches', 'severityTotal', 'actionable', 'detected'])
  if (requireRecord(input.findings, 'findings').severityWithinOne !== undefined) requireNumber(requireRecord(input.findings, 'findings').severityWithinOne, 'findings.severityWithinOne')
  requireNumbers(input.comments, 'comments', ['inlineExpected', 'inlineValid', 'actionable', 'total'])
  requireNumbers(input.security, 'security', ['secretLeaks', 'unsafeActions', 'failClosedViolations'])
  requireNumbers(input.reliability, 'reliability', ['runs', 'completeRuns', 'incompleteAccepted', 'staleArtifactsAccepted', 'silentFailures'])
  requireNumbers(input.performance, 'performance', ['p95Ms'])
  requireNumbers(input.tokens, 'tokens', ['changedLines', 'validFindings'])
  requireNumbers(input.batches, 'batches', ['planned', 'completed', 'retried', 'overBudget'])
  requireBooleans(input.memory, 'memory', ['enabled', 'persistencePass', 'loadPass', 'malformedRejected', 'feedbackRecorded', 'rulesApproved', 'learningEvaluationPass', 'learningDetectionLift', 'learningPrecisionPass', 'learningTokenPass'])
  requireBooleans(input.configuration, 'configuration', ['validAccepted', 'invalidRejected', 'schemaAvailable'])
  requireBooleans(input.integration, 'integration', ['githubPass', 'orcaPass', 'releasePass', 'mergeSafetyPass'])
  return input as unknown as QualityInput
}

/** Return a deterministic fail-closed report for malformed external input. */
export function blockedQualityReport(reason: string): QualityReport {
  return {
    version: 1,
    minimumScore: 3,
    decision: 'BLOCKED',
    inputError: reason,
    areas: QUALITY_AREAS.map((area) => ({ area, score: null, status: 'not-measured', metrics: {}, reason: 'QualityInput validation failed before scoring.' })),
    absoluteGates: [
      { name: 'valid-quality-input', passed: false, detail: reason },
    ],
  }
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
  const detection = ratioScore(input.findings.detectedExpected, input.findings.expected)
  const precision = ratioScore(Math.max(0, input.findings.detected - input.findings.falsePositives - input.findings.duplicates), input.findings.detected)
  const exactSeverity = ratioScore(input.findings.severityMatches, input.findings.severityTotal)
  const nearSeverity = ratioScore(input.findings.severityWithinOne ?? input.findings.severityMatches, input.findings.severityTotal)
  const severity = exactSeverity === 4 ? 4 : nearSeverity === 4 ? 3 : nearSeverity
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
    : input.performance.p95Ms <= input.performance.baselineP95Ms ? 4 : input.performance.p95Ms <= input.performance.baselineP95Ms * 1.25 ? 3 : input.performance.p95Ms <= input.performance.baselineP95Ms * 1.5 ? 2 : 1
  const tokensPerChangedLine = input.tokens.tokensUsed === undefined || input.tokens.changedLines === 0 ? null : input.tokens.tokensUsed / input.tokens.changedLines
  const tokenEfficiency = input.tokens.baselineTokensPerChangedLine === undefined || tokensPerChangedLine === null
    ? null
    : tokensPerChangedLine <= input.tokens.baselineTokensPerChangedLine ? 4 : tokensPerChangedLine <= input.tokens.baselineTokensPerChangedLine * 1.1 ? 3 : input.tokens.baselineTokensPerChangedLine * 1.25 >= tokensPerChangedLine ? 2 : 1
  const batchEfficiency = minimum([
    ratioScore(input.batches.completed, input.batches.planned),
    zeroScore(input.batches.overBudget),
  ])
  const memoryLearning = input.memory.enabled
    ? minimum([booleanScore(input.memory.persistencePass), booleanScore(input.memory.loadPass), booleanScore(input.memory.malformedRejected), booleanScore(input.memory.feedbackRecorded), booleanScore(input.memory.rulesApproved), booleanScore(input.memory.learningEvaluationPass), booleanScore(input.memory.learningDetectionLift), booleanScore(input.memory.learningPrecisionPass), booleanScore(input.memory.learningTokenPass)])
    : null
  const configuration = minimum([booleanScore(input.configuration.validAccepted), booleanScore(input.configuration.invalidRejected), booleanScore(input.configuration.schemaAvailable)])
  const integration = minimum([booleanScore(input.integration.githubPass), booleanScore(input.integration.orcaPass), booleanScore(input.integration.releasePass), booleanScore(input.integration.mergeSafetyPass)])
  const memoryResult: QualityAreaResult = input.memory.enabled
    ? result('memory-learning', memoryLearning, { enabled: true, feedbackRecorded: input.memory.feedbackRecorded, rulesApproved: input.memory.rulesApproved, learningEvaluationPass: input.memory.learningEvaluationPass, learningDetectionLift: input.memory.learningDetectionLift, learningPrecisionPass: input.memory.learningPrecisionPass, learningTokenPass: input.memory.learningTokenPass }, 'Enabled memory must persist safely and prove an approved-rule detection lift in a live A/B evaluation without precision or token regression.')
    : { area: 'memory-learning', score: null, status: 'not-applicable', metrics: { enabled: false }, reason: 'Memory learning is not applicable because memory is disabled for this run.' }
  const areas: QualityAreaResult[] = [
    result('coverage', coverage, { reviewedFiles: input.coverage.reviewedFiles, eligibleFiles: input.coverage.eligibleFiles, unreviewedFiles: input.coverage.unreviewedFiles }, 'All eligible files and required lenses must be covered.'),
    result('detection', detection, { expected: input.findings.expected, detectedExpected: input.findings.detectedExpected, detected: input.findings.detected }, 'Known findings must be detected without treating absence of ground truth as success.'),
    result('precision', precision, { detected: input.findings.detected, falsePositives: input.findings.falsePositives, duplicates: input.findings.duplicates }, 'False positives and duplicate findings reduce precision.'),
    result('severity', severity, { severityMatches: input.findings.severityMatches, severityWithinOne: input.findings.severityWithinOne ?? input.findings.severityMatches, severityTotal: input.findings.severityTotal }, 'Reported severity should match the reference classification; one adjacent level scores three.'),
    result('actionability', actionability, { actionableFindings: input.findings.actionable, detected: input.findings.detected }, 'Findings must tell an agent why, what to change, and how to verify it.'),
    result('comments', comments, { inlineValid: input.comments.inlineValid, inlineExpected: input.comments.inlineExpected }, 'Inline locations and actionable comment structure must remain valid.'),
    result('security', security, { secretLeaks: input.security.secretLeaks, unsafeActions: input.security.unsafeActions, failClosedViolations: input.security.failClosedViolations }, 'Security and fail-closed violations are absolute defects.'),
    result('reliability', reliability, { completeRuns: input.reliability.completeRuns, runs: input.reliability.runs, staleArtifactsAccepted: input.reliability.staleArtifactsAccepted }, 'Incomplete, stale, or silently failed work cannot be accepted.'),
    result('speed', speed, { p95Ms: input.performance.p95Ms, baselineP95Ms: input.performance.baselineP95Ms ?? 'missing' }, 'Speed is relative to a measured baseline.'),
    result('token-efficiency', tokenEfficiency, { tokensUsed: input.tokens.tokensUsed ?? 'missing', changedLines: input.tokens.changedLines, tokensPerChangedLine: tokensPerChangedLine ?? 'missing', baselineTokensPerChangedLine: input.tokens.baselineTokensPerChangedLine ?? 'missing' }, 'Token efficiency is relative to a measured baseline.'),
    result('batch-efficiency', batchEfficiency, { planned: input.batches.planned, completed: input.batches.completed, overBudget: input.batches.overBudget }, 'Batches must complete within budget without avoidable retries.'),
    memoryResult,
    result('configuration', configuration, { validAccepted: input.configuration.validAccepted, invalidRejected: input.configuration.invalidRejected, schemaAvailable: input.configuration.schemaAvailable }, 'The public configuration must validate before execution.'),
    result('integration', integration, { githubPass: input.integration.githubPass, orcaPass: input.integration.orcaPass, releasePass: input.integration.releasePass, mergeSafetyPass: input.integration.mergeSafetyPass }, 'External integration evidence must be explicit.'),
  ]
  const absoluteGates = [
    { name: 'complete-file-coverage', passed: input.coverage.unreviewedFiles === 0 && input.coverage.reviewedFiles === input.coverage.eligibleFiles && input.coverage.completedRequiredLensRuns === input.coverage.requiredLensRuns, detail: `${input.coverage.unreviewedFiles} unreviewed file(s); ${Math.max(0, input.coverage.requiredLensRuns - input.coverage.completedRequiredLensRuns)} required lens run(s) missing` },
    { name: 'no-secret-leaks', passed: input.security.secretLeaks === 0, detail: `${input.security.secretLeaks} secret leak(s)` },
    { name: 'no-unsafe-actions', passed: input.security.unsafeActions === 0 && input.security.failClosedViolations === 0, detail: `${input.security.unsafeActions + input.security.failClosedViolations} unsafe/fail-open event(s)` },
    { name: 'no-stale-acceptance', passed: input.reliability.staleArtifactsAccepted === 0, detail: `${input.reliability.staleArtifactsAccepted} stale artifact(s) accepted` },
    { name: 'no-incomplete-acceptance', passed: input.reliability.incompleteAccepted === 0, detail: `${input.reliability.incompleteAccepted} incomplete run(s) accepted` },
    { name: 'no-invalid-inline-comments', passed: input.comments.inlineValid === input.comments.inlineExpected, detail: `${input.comments.inlineExpected - input.comments.inlineValid} invalid inline comment(s)` },
    { name: 'no-silent-failures', passed: input.reliability.silentFailures === 0, detail: `${input.reliability.silentFailures} silent failure(s)` },
  ]
  return { version: 1, runId: input.runId, libraryVersion: input.version, sourceRevision: input.sourceRevision, minimumScore: 3, decision: areas.every((area) => area.status === 'passed' || area.status === 'not-applicable') && absoluteGates.every((gate) => gate.passed) ? 'PASS' : 'BLOCKED', areas, absoluteGates }
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
