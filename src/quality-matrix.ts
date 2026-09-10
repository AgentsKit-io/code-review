export const QUALITY_AREAS = [
  'coverage', 'detection', 'precision', 'severity', 'actionability', 'comments',
  'security', 'reliability', 'speed', 'token-efficiency', 'batch-efficiency',
  'memory-learning', 'configuration', 'integration',
] as const

export type QualityArea = typeof QUALITY_AREAS[number]
export type QualityStatus = 'passed' | 'failed' | 'not-measured' | 'not-applicable'
export type QualityEvidence =
  | { kind: 'synthetic'; fixtureId: string }
  | { kind: 'real-run'; repository: string; pullNumber: number; headSha: string }
  | { kind: 'real-campaign'; campaignId: string }

export interface QualityCampaignSummary {
  discovered: number
  terminal: number
  completed: number
  partial: number
  blocked: number
  skipped: number
  cancelled: number
  qualityReports: number
  retries: number
  wastedCalls: number
  wallClockMs: number
  baselineWallClockMs?: number
}

export interface QualityInput {
  runId?: string
  version?: string
  sourceRevision?: string
  evidence: QualityEvidence
  campaign?: QualityCampaignSummary
  coverage: { eligibleFiles: number; reviewedFiles: number; unreviewedFiles: number; requiredLensRuns: number; completedRequiredLensRuns: number }
  findings: { expected: number; detectedExpected: number; falsePositives: number; duplicates: number; severityMatches: number; severityWithinOne?: number; severityTotal: number; actionable: number; detected: number }
  comments: { inlineExpected: number; inlineValid: number; actionable: number; total: number }
  security: { secretLeaks: number; unsafeActions: number; failClosedViolations: number }
  reliability: { runs: number; completeRuns: number; incompleteAccepted: number; staleArtifactsAccepted: number; silentFailures: number }
  performance: { p95Ms: number; baselineP95Ms?: number; wallClockMs?: number; baselineWallClockMs?: number }
  tokens: { tokensUsed?: number; changedLines: number; validFindings: number; baselineChangedLines?: number; baselineTokensPerChangedLine?: number; baselineTokensPerProviderCall?: number; accounting?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningOutputTokens?: number; memoryTokens?: number; retryTokens?: number; total?: number; providerCalls?: number; wallClockMs?: number } }
  batches: { planned: number; completed: number; retried: number; overBudget: number; wastedCalls?: number; providerCalls?: number; baselineProviderCalls?: number }
  cache?: { hits: number; misses: number; corruptMisses: number; staleMisses: number; unvalidatedMisses: number; savedTokens: number }
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
  evidence?: QualityEvidence
  campaign?: QualityCampaignSummary
  minimumScore: 3
  decision: 'PASS' | 'BLOCKED'
  areas: QualityAreaResult[]
  absoluteGates: { name: string; passed: boolean; detail: string }[]
  inputError?: string
}

export interface QualityRegressionPolicy {
  maxScoreDrop?: number
  blockNewlyUnmeasured?: boolean
}

export interface QualityCampaignInput {
  evidence: Extract<QualityEvidence, { kind: 'real-campaign' }>
  campaign: QualityCampaignSummary
  pullRequestReports: QualityReport[]
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
  const evidence = requireRecord(input.evidence, 'evidence')
  if (!['synthetic', 'real-run', 'real-campaign'].includes(String(evidence.kind))) throw new Error('evidence.kind must be synthetic, real-run, or real-campaign')
  if (evidence.kind === 'synthetic' && typeof evidence.fixtureId !== 'string') throw new Error('evidence.fixtureId must be a string')
  if (evidence.kind === 'real-run' && (typeof evidence.repository !== 'string' || typeof evidence.pullNumber !== 'number' || typeof evidence.headSha !== 'string')) throw new Error('real-run evidence requires repository, pullNumber, and headSha')
  if (evidence.kind === 'real-campaign' && (typeof evidence.campaignId !== 'string' || !input.campaign)) throw new Error('real-campaign evidence requires campaignId and campaign')
  requireNumbers(input.coverage, 'coverage', ['eligibleFiles', 'reviewedFiles', 'unreviewedFiles', 'requiredLensRuns', 'completedRequiredLensRuns'])
  requireNumbers(input.findings, 'findings', ['expected', 'detectedExpected', 'falsePositives', 'duplicates', 'severityMatches', 'severityTotal', 'actionable', 'detected'])
  if (requireRecord(input.findings, 'findings').severityWithinOne !== undefined) requireNumber(requireRecord(input.findings, 'findings').severityWithinOne, 'findings.severityWithinOne')
  requireNumbers(input.comments, 'comments', ['inlineExpected', 'inlineValid', 'actionable', 'total'])
  requireNumbers(input.security, 'security', ['secretLeaks', 'unsafeActions', 'failClosedViolations'])
  requireNumbers(input.reliability, 'reliability', ['runs', 'completeRuns', 'incompleteAccepted', 'staleArtifactsAccepted', 'silentFailures'])
  requireNumbers(input.performance, 'performance', ['p95Ms'])
  requireNumbers(input.tokens, 'tokens', ['changedLines', 'validFindings'])
  const tokensRecord = requireRecord(input.tokens, 'tokens')
  for (const key of ['baselineChangedLines', 'baselineTokensPerChangedLine', 'baselineTokensPerProviderCall']) if (tokensRecord[key] !== undefined) requireNumber(tokensRecord[key], `tokens.${key}`)
  if (requireRecord(input.tokens, 'tokens').accounting !== undefined) {
    const accounting = requireRecord(input.tokens, 'tokens').accounting
    const accountingRecord = requireRecord(accounting, 'tokens.accounting')
    for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'memoryTokens', 'retryTokens', 'total', 'providerCalls', 'wallClockMs']) if (accountingRecord[key] !== undefined) requireNumber(accountingRecord[key], `tokens.accounting.${key}`)
  }
  requireNumbers(input.batches, 'batches', ['planned', 'completed', 'retried', 'overBudget'])
  for (const key of ['wastedCalls', 'providerCalls', 'baselineProviderCalls']) if (requireRecord(input.batches, 'batches')[key] !== undefined) requireNumber(requireRecord(input.batches, 'batches')[key], `batches.${key}`)
  const performance = requireRecord(input.performance, 'performance')
  if (performance.wallClockMs !== undefined) requireNumber(performance.wallClockMs, 'performance.wallClockMs')
  if (performance.baselineWallClockMs !== undefined) requireNumber(performance.baselineWallClockMs, 'performance.baselineWallClockMs')
  if (input.campaign !== undefined) requireNumbers(input.campaign, 'campaign', ['discovered', 'terminal', 'completed', 'partial', 'blocked', 'skipped', 'cancelled', 'qualityReports', 'retries', 'wastedCalls', 'wallClockMs'])
  if (input.cache !== undefined) requireNumbers(input.cache, 'cache', ['hits', 'misses', 'corruptMisses', 'staleMisses', 'unvalidatedMisses', 'savedTokens'])
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
function overheadScore(value: number, denominator: number): number | null {
  if (denominator === 0) return value === 0 ? 4 : 1
  const ratio = value / denominator
  return ratio === 0 ? 4 : ratio <= 0.1 ? 3 : ratio <= 0.25 ? 2 : 1
}
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
  const campaignReliability = input.campaign ? minimum([
    ratioScore(input.campaign.terminal, input.campaign.discovered),
    ratioScore(input.campaign.completed, input.campaign.terminal - input.campaign.skipped),
    zeroScore(input.campaign.cancelled),
  ]) : null
  const reliability = minimum([
    ratioScore(input.reliability.completeRuns, input.reliability.runs),
    campaignReliability,
    zeroScore(input.reliability.incompleteAccepted),
    zeroScore(input.reliability.staleArtifactsAccepted),
    zeroScore(input.reliability.silentFailures),
  ])
  const p95Score = input.performance.baselineP95Ms === undefined || input.performance.baselineP95Ms <= 0
    ? null
    : input.performance.p95Ms <= input.performance.baselineP95Ms ? 4 : input.performance.p95Ms <= input.performance.baselineP95Ms * 1.25 ? 3 : input.performance.p95Ms <= input.performance.baselineP95Ms * 1.5 ? 2 : 1
  const wallClockScore = input.performance.wallClockMs === undefined || input.performance.baselineWallClockMs === undefined || input.performance.baselineWallClockMs <= 0
    ? null
    : input.performance.wallClockMs <= input.performance.baselineWallClockMs ? 4 : input.performance.wallClockMs <= input.performance.baselineWallClockMs * 1.25 ? 3 : input.performance.wallClockMs <= input.performance.baselineWallClockMs * 1.5 ? 2 : 1
  const speed = minimum([p95Score, wallClockScore])
  const tokenDimensions = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'memoryTokens', 'retryTokens'] as const
  const accounting = input.tokens.accounting
  const accountedTokens = accounting && tokenDimensions.every((dimension) => accounting[dimension] !== undefined)
    ? accounting.total ?? tokenDimensions.reduce((total, dimension) => total + accounting[dimension]!, 0)
    : input.tokens.tokensUsed
  const tokensPerChangedLine = accountedTokens === undefined || input.tokens.changedLines === 0 ? null : accountedTokens / input.tokens.changedLines
  const providerCalls = accounting?.providerCalls ?? input.batches.providerCalls
  const tokensPerProviderCall = accountedTokens === undefined || providerCalls === undefined || providerCalls === 0 ? null : accountedTokens / providerCalls
  const comparableShape = input.tokens.baselineChangedLines === undefined || input.tokens.changedLines === 0
    ? true
    : input.tokens.changedLines >= input.tokens.baselineChangedLines / 2 && input.tokens.changedLines <= input.tokens.baselineChangedLines * 2
  const lineTokenEfficiency = input.tokens.baselineTokensPerChangedLine === undefined || tokensPerChangedLine === null
    ? null
    : tokensPerChangedLine <= input.tokens.baselineTokensPerChangedLine ? 4 : tokensPerChangedLine <= input.tokens.baselineTokensPerChangedLine * 1.1 ? 3 : input.tokens.baselineTokensPerChangedLine * 1.25 >= tokensPerChangedLine ? 2 : 1
  const callTokenEfficiency = input.tokens.baselineTokensPerProviderCall === undefined || tokensPerProviderCall === null
    ? null
    : tokensPerProviderCall <= input.tokens.baselineTokensPerProviderCall ? 4 : tokensPerProviderCall <= input.tokens.baselineTokensPerProviderCall * 1.1 ? 3 : input.tokens.baselineTokensPerProviderCall * 1.25 >= tokensPerProviderCall ? 2 : 1
  const tokenEfficiency = comparableShape ? lineTokenEfficiency : callTokenEfficiency
  const tokenComparisonBasis = comparableShape ? 'changed-line' : 'provider-call'
  const batchWastedCalls = input.batches.wastedCalls ?? input.campaign?.wastedCalls ?? 0
  const batchEfficiency = minimum([
    ratioScore(input.batches.completed, input.batches.planned),
    zeroScore(input.batches.overBudget),
    overheadScore(input.batches.retried, input.batches.planned + input.batches.retried),
    overheadScore(batchWastedCalls, input.batches.providerCalls ?? input.batches.planned + batchWastedCalls),
    input.batches.providerCalls !== undefined && input.batches.baselineProviderCalls !== undefined && input.batches.baselineProviderCalls > 0
      ? input.batches.providerCalls <= input.batches.baselineProviderCalls ? 4 : input.batches.providerCalls <= input.batches.baselineProviderCalls * 1.25 ? 3 : input.batches.providerCalls <= input.batches.baselineProviderCalls * 1.5 ? 2 : 1
      : null,
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
    result('speed', speed, { p95Ms: input.performance.p95Ms, baselineP95Ms: input.performance.baselineP95Ms ?? 'missing', wallClockMs: input.performance.wallClockMs ?? 'missing', baselineWallClockMs: input.performance.baselineWallClockMs ?? 'missing' }, 'Speed is relative to measured p95 and complete wall-clock baselines.'),
    result('token-efficiency', tokenEfficiency, { tokensUsed: accountedTokens ?? 'missing', changedLines: input.tokens.changedLines, baselineChangedLines: input.tokens.baselineChangedLines ?? 'missing', tokensPerChangedLine: tokensPerChangedLine ?? 'missing', baselineTokensPerChangedLine: input.tokens.baselineTokensPerChangedLine ?? 'missing', providerCalls: providerCalls ?? 'missing', tokensPerProviderCall: tokensPerProviderCall ?? 'missing', baselineTokensPerProviderCall: input.tokens.baselineTokensPerProviderCall ?? 'missing', comparisonBasis: tokenComparisonBasis, accounting: accounting ? (tokenDimensions.every((dimension) => accounting[dimension] !== undefined) ? 'complete' : 'partial') : 'missing' }, 'Token efficiency uses changed-line comparison for similarly sized PRs and provider-call comparison for materially different PR sizes.'),
    result('batch-efficiency', batchEfficiency, { planned: input.batches.planned, completed: input.batches.completed, retried: input.batches.retried, wastedCalls: batchWastedCalls, overBudget: input.batches.overBudget, providerCalls: input.batches.providerCalls ?? 'missing' }, 'Batches must complete within budget without avoidable retries, wasted calls, or provider-call regressions.'),
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
    ...(input.campaign ? [{ name: 'campaign-terminal-coverage', passed: input.campaign.terminal === input.campaign.discovered && input.campaign.completed + input.campaign.partial + input.campaign.blocked + input.campaign.skipped + input.campaign.cancelled === input.campaign.terminal, detail: `${input.campaign.terminal}/${input.campaign.discovered} discovered pull requests reached terminal outcome` }, { name: 'campaign-quality-report-coverage', passed: input.campaign.qualityReports === input.campaign.completed, detail: `${input.campaign.qualityReports}/${input.campaign.completed} completed pull requests have quality matrices` }] : []),
  ]
  return { version: 1, runId: input.runId, libraryVersion: input.version, sourceRevision: input.sourceRevision, evidence: input.evidence, campaign: input.campaign, minimumScore: 3, decision: areas.every((area) => area.status === 'passed' || area.status === 'not-applicable') && absoluteGates.every((gate) => gate.passed) ? 'PASS' : 'BLOCKED', areas, absoluteGates }
}

export function evaluateCampaignQuality(input: QualityCampaignInput): QualityReport {
  const reports = input.pullRequestReports
  if (!reports.length) {
    const blocked = blockedQualityReport('campaign has no pull-request quality reports')
    return { ...blocked, evidence: input.evidence, campaign: input.campaign }
  }
  const campaignReliability = minimum([
    ratioScore(input.campaign.terminal, input.campaign.discovered),
    ratioScore(input.campaign.completed, input.campaign.terminal - input.campaign.skipped),
    zeroScore(input.campaign.cancelled),
  ])
  const areas = QUALITY_AREAS.map((area) => {
    const entries = reports.map((report) => report.areas.find((candidate) => candidate.area === area)).filter((entry): entry is QualityAreaResult => Boolean(entry))
    const score = minimum(entries.map((entry) => entry.score))
    return result(area, area === 'reliability' ? minimum([score, campaignReliability]) : score, { reports: reports.length, passingReports: entries.filter((entry) => entry.status === 'passed').length, discovered: input.campaign.discovered, terminal: input.campaign.terminal }, area === 'reliability' ? 'Campaign reliability includes every discovered pull request and its terminal outcome.' : `Campaign score is bounded by the lowest pull-request result for ${area}.`)
  })
  const terminalCoverage = input.campaign.terminal === input.campaign.discovered && input.campaign.completed + input.campaign.partial + input.campaign.blocked + input.campaign.skipped + input.campaign.cancelled === input.campaign.terminal && input.campaign.qualityReports === input.campaign.completed
  const absoluteGates = [
    ...reports.flatMap((report, index) => report.absoluteGates.filter((gate) => !gate.passed).map((gate) => ({ ...gate, name: `pull-request-${index + 1}:${gate.name}` }))),
    { name: 'campaign-terminal-coverage', passed: terminalCoverage, detail: `${input.campaign.terminal}/${input.campaign.discovered} discovered pull requests reached terminal outcome` },
    { name: 'campaign-quality-report-coverage', passed: input.campaign.qualityReports === input.campaign.completed, detail: `${input.campaign.qualityReports}/${input.campaign.completed} completed pull requests have quality matrices` },
  ]
  const decision = areas.every((area) => area.status === 'passed' || area.status === 'not-applicable') && absoluteGates.every((gate) => gate.passed) ? 'PASS' : 'BLOCKED'
  return { version: 1, runId: input.evidence.campaignId, libraryVersion: reports[0].libraryVersion, sourceRevision: reports[0].sourceRevision, evidence: input.evidence, campaign: input.campaign, minimumScore: 3, decision, areas, absoluteGates }
}

export function compareQuality(current: QualityReport, baseline: QualityReport, policy: QualityRegressionPolicy = {}): { regressions: { area: QualityArea; from: number | null; to: number | null }[]; materialRegressions: { area: QualityArea; from: number | null; to: number | null }[]; improved: QualityArea[] } {
  const regressions: { area: QualityArea; from: number | null; to: number | null }[] = []
  const materialRegressions: { area: QualityArea; from: number | null; to: number | null }[] = []
  const improved: QualityArea[] = []
  // A one-point change still satisfies the matrix floor (3/4); only a drop
  // below the floor is material by default. Callers can opt into stricter
  // policy.maxScoreDrop when their baseline requires it.
  const maxScoreDrop = policy.maxScoreDrop ?? 2
  const blockNewlyUnmeasured = policy.blockNewlyUnmeasured ?? true
  for (const area of current.areas) {
    const before = baseline.areas.find((candidate) => candidate.area === area.area)?.score ?? null
    if (before !== null && area.score !== null && area.score < before) regressions.push({ area: area.area, from: before, to: area.score })
    if ((maxScoreDrop > 0 && before !== null && area.score !== null && before - area.score >= maxScoreDrop) || (blockNewlyUnmeasured && before !== null && area.score === null)) materialRegressions.push({ area: area.area, from: before, to: area.score })
    if (before !== null && area.score !== null && area.score > before) improved.push(area.area)
  }
  return { regressions, materialRegressions, improved }
}

export function evaluateQualityAgainstBaseline(input: QualityInput, baseline: QualityReport, policy: QualityRegressionPolicy = {}): QualityReport {
  const report = evaluateQuality(input)
  const comparison = compareQuality(report, baseline, policy)
  const passed = comparison.materialRegressions.length === 0
  const absoluteGates = [...report.absoluteGates, { name: 'no-material-regressions', passed, detail: passed ? 'no configured material quality regression' : `${comparison.materialRegressions.length} material regression(s)` }]
  return { ...report, decision: report.decision === 'PASS' && passed ? 'PASS' : 'BLOCKED', absoluteGates }
}
