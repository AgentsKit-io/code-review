import { createHash } from 'node:crypto'
import type { ReviewResult } from '../agents/code-review/agent.js'
import type { BatchCoverageState, BatchReviewArtifact } from './batch-coverage.js'

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

export type CanaryResult = {
  ready: boolean
  blockers: HarnessBlocker[]
  artifact: BatchReviewArtifact
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex')
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

function canaryChecks(state: BatchCoverageState, artifact: BatchReviewArtifact): HarnessCheck[] {
  const expected = state.batches.find((batch) => batch.index === artifact.batch.index)
  const execution = artifact.review.execution
  const evidence = artifact.review.evidence
  return [
    { id: 'identity.sha', ok: artifact.headSha === state.headSha, detail: 'artifact SHA matches the locked source SHA', remediation: 'discard the artifact and rerun against the locked SHA' },
    { id: 'identity.policy', ok: artifact.policyFingerprint === state.policyFingerprint, detail: 'artifact policy fingerprint matches the locked manifest', remediation: 'use one immutable configuration for planning and execution' },
    { id: 'manifest.files', ok: Boolean(expected && expected.files.join('\0') === artifact.batch.files.join('\0')), detail: 'artifact files match the planned batch', remediation: 'regenerate the batch from the immutable manifest' },
    { id: 'execution.complete', ok: execution.failed === 0 && execution.succeeded === execution.attempted, detail: `${execution.succeeded}/${execution.attempted} executions succeeded`, remediation: 'fix provider or budget failures before fan-out' },
    { id: 'execution.complete-review', ok: artifact.review.incomplete === false && (artifact.review.unreviewed?.length ?? 0) === 0, detail: 'review has complete coverage for the batch', remediation: 'do not accept incomplete evidence' },
    { id: 'review.profile', ok: evidence.profile === 'full', detail: `review profile is ${evidence.profile}`, remediation: 'run the canary with the full required review policy' },
    { id: 'review.lenses', ok: (artifact.review.missingRequiredLenses?.length ?? 0) === 0, detail: 'all required lenses produced evidence', remediation: 'fix missing required lenses before fan-out' },
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
