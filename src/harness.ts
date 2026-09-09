import type { ReviewResult } from '../agents/code-review/agent.js'
import type { BatchCoverageState, BatchReviewArtifact } from './batch-coverage.js'
import { stableFingerprint } from './stable-fingerprint.js'

export type HarnessCheck = {
  id: string
  ok: boolean
  detail: string
  remediation?: string
}

export type HarnessBlocker = HarnessCheck & { severity: 'blocker' | 'high' }

export type HarnessReport = {
  status: 'ready' | 'blocked'
  blockers: HarnessBlocker[]
  checks: HarnessCheck[]
}

export type HarnessContract = {
  version: 1
  runId: string
  sourceSha: string
  configFingerprint: string
  manifestFingerprint: string
  createdAt: string
}

export type HarnessStage = 'contract' | 'preflight' | 'replay' | 'canary' | 'full-review' | 'consolidation' | 'quality' | 'gates' | 'complete' | 'blocked'

export type HarnessRunState = {
  runId: string
  stage: HarnessStage
  canaryAttempts: number
  maxCanaryAttempts: number
  completedBatches: number[]
  pendingBatches: number[]
  blockers: HarnessBlocker[]
}


export type CanaryResult = {
  ready: boolean
  blockers: HarnessBlocker[]
  artifact: BatchReviewArtifact
}

export function fingerprint(value: unknown): string {
  return stableFingerprint(value)
}

export function createHarnessContract(input: Omit<HarnessContract, 'version' | 'configFingerprint' | 'manifestFingerprint'> & { config: unknown; manifest: unknown }): HarnessContract {
  return {
    version: 1,
    runId: input.runId,
    sourceSha: input.sourceSha,
    configFingerprint: fingerprint(input.config),
    manifestFingerprint: fingerprint(input.manifest),
    createdAt: input.createdAt,
  }
}

export function runBlockerSweep(checks: readonly HarnessCheck[]): HarnessReport {
  const ordered = [...checks].sort((a, b) => a.id.localeCompare(b.id))
  const blockers = ordered.filter((check) => !check.ok).map((check) => ({ ...check, severity: 'blocker' as const }))
  return { status: blockers.length ? 'blocked' : 'ready', blockers, checks: ordered }
}

export function createHarnessRun(input: { runId: string; batchIndices: readonly number[]; maxCanaryAttempts?: number }): HarnessRunState {
  const pendingBatches = [...new Set(input.batchIndices)].sort((a, b) => a - b)
  if (pendingBatches.some((index) => !Number.isInteger(index) || index < 0)) throw new Error('batch indices must be non-negative integers')
  const maxCanaryAttempts = input.maxCanaryAttempts ?? 2
  if (!Number.isInteger(maxCanaryAttempts) || maxCanaryAttempts < 1) throw new Error('max canary attempts must be a positive integer')
  return { runId: input.runId, stage: 'contract', canaryAttempts: 0, maxCanaryAttempts, completedBatches: [], pendingBatches, blockers: [] }
}

export function recordCanaryAttempt(state: HarnessRunState, result: CanaryResult): HarnessRunState {
  if (state.stage !== 'contract' && state.stage !== 'canary') throw new Error('canary cannot run after the review has advanced or stopped')
  const canaryAttempts = state.canaryAttempts + 1
  if (result.ready) return { ...state, stage: 'full-review', canaryAttempts, blockers: [] }
  const blockers = result.blockers
  return { ...state, stage: canaryAttempts >= state.maxCanaryAttempts ? 'blocked' : 'canary', canaryAttempts, blockers }
}

export function recordBatchCompletion(state: HarnessRunState, batchIndex: number): HarnessRunState {
  if (state.stage !== 'full-review') throw new Error('batches cannot complete before the canary')
  if (!state.pendingBatches.includes(batchIndex) || state.completedBatches.includes(batchIndex)) throw new Error(`batch ${batchIndex} is not pending`)
  const completedBatches = [...state.completedBatches, batchIndex].sort((a, b) => a - b)
  const pendingBatches = state.pendingBatches.filter((index) => index !== batchIndex)
  return { ...state, stage: pendingBatches.length ? 'full-review' : 'consolidation', completedBatches, pendingBatches }
}

function canaryChecks(state: BatchCoverageState, artifact: BatchReviewArtifact): HarnessCheck[] {
  const expected = state.batches.find((batch) => batch.index === artifact.batch.index)
  const execution = artifact.review.execution
  const evidence = artifact.review.evidence
  return [
    { id: 'identity.sha', ok: artifact.headSha === state.headSha, detail: 'artifact SHA matches the locked source SHA', remediation: 'discard the artifact and rerun against the locked SHA' },
    { id: 'identity.policy', ok: artifact.policyFingerprint === state.policyFingerprint, detail: 'artifact policy fingerprint matches the locked manifest', remediation: 'use one immutable configuration for planning and execution' },
    { id: 'manifest.files', ok: Boolean(expected && expected.files.join('\0') === artifact.batch.files.join('\0')), detail: 'artifact files match the planned batch', remediation: 'regenerate the batch from the immutable manifest' },
    { id: 'execution.complete', ok: execution.failed === 0 && execution.succeeded === execution.attempted, detail: `${execution.succeeded}/${execution.attempted} executions succeeded`, remediation: 'fix provider or budget failures before analysis' },
    { id: 'execution.complete-review', ok: artifact.review.incomplete === false && (artifact.review.unreviewed?.length ?? 0) === 0, detail: 'review has complete coverage for the batch', remediation: 'do not accept incomplete evidence' },
    { id: 'review.profile', ok: evidence.profile === 'full', detail: `review profile is ${evidence.profile}`, remediation: 'run the canary with the full required review policy' },
    { id: 'review.lenses', ok: (artifact.review.missingRequiredLenses?.length ?? 0) === 0, detail: 'all required dimensions produced evidence', remediation: 'fix missing required dimensions before analysis' },
    { id: 'execution.deadline', ok: evidence.deadlineExceeded === false, detail: 'batch completed before its deadline', remediation: 'reduce scope or increase bounded capacity' },
  ]
}

export function validateCanary(state: BatchCoverageState, artifact: BatchReviewArtifact): CanaryResult {
  const report = runBlockerSweep(canaryChecks(state, artifact))
  return { ready: report.status === 'ready', blockers: report.blockers, artifact }
}

export function assertCanaryReady(state: BatchCoverageState, artifact: BatchReviewArtifact): ReviewResult {
  const result = validateCanary(state, artifact)
  if (!result.ready) throw new Error(`canary blocked: ${result.blockers.map((blocker) => `${blocker.id}: ${blocker.detail}`).join('; ')}`)
  return artifact.review
}
