import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { acquireCampaignLease, releaseCampaignLease, renewCampaignLease, writeLeasedJson, type CampaignLease } from './campaign-store.js'
import { CampaignTerminalOutcomeSchema, PullRequestTerminalOutcomeSchema, type PullRequestTerminalOutcome } from './domain-contracts.js'
import { packageVersion } from './review-policy.js'
import { stableFingerprint } from './stable-fingerprint.js'
import { CampaignPreflightReportSchema, type CampaignPreflightEntry, type CampaignPreflightReport } from './campaign-preflight.js'

const CampaignExecutionEntrySchema = z.object({
  ref: z.object({ repository: z.string(), id: z.string() }).strict(),
  title: z.string().optional(), author: z.string().optional(), headRevision: z.string().optional(),
  state: z.enum(['pending', 'running', 'terminal']), outcome: PullRequestTerminalOutcomeSchema.nullable(), attempts: z.number().int().nonnegative(),
  reason: z.string().optional(), startedAt: z.string().datetime().optional(), finishedAt: z.string().datetime().optional(), durationMs: z.number().int().nonnegative().optional(),
}).strict().superRefine((entry, context) => {
  if ((entry.state === 'terminal') !== (entry.outcome !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'only terminal entries have an outcome', path: ['outcome'] })
  if (entry.state === 'running' && !entry.startedAt) context.addIssue({ code: z.ZodIssueCode.custom, message: 'running entries require startedAt', path: ['startedAt'] })
  if (entry.state === 'terminal' && !entry.finishedAt) context.addIssue({ code: z.ZodIssueCode.custom, message: 'terminal entries require finishedAt', path: ['finishedAt'] })
})

const reportFields = {
  version: z.literal(1), campaignId: z.string().min(1), identityFingerprint: z.string().length(64), repository: z.string().nullable(),
  configFingerprint: z.string().length(64).nullable(), state: z.enum(['running', 'terminal']), outcome: CampaignTerminalOutcomeSchema.nullable(),
  concurrency: z.number().int().positive(), startedAt: z.string().datetime(), updatedAt: z.string().datetime(), finishedAt: z.string().datetime().optional(),
  pullRequests: z.array(CampaignExecutionEntrySchema), error: z.string().optional(),
}
const CampaignExecutionPayloadSchema = z.object(reportFields).strict().superRefine((report, context) => {
  if ((report.state === 'terminal') !== (report.outcome !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'only terminal campaigns have an outcome', path: ['outcome'] })
  if (report.state === 'terminal' && !report.finishedAt) context.addIssue({ code: z.ZodIssueCode.custom, message: 'terminal campaigns require finishedAt', path: ['finishedAt'] })
  const refs = report.pullRequests.map((entry) => `${entry.ref.repository}#${entry.ref.id}`)
  if (new Set(refs).size !== refs.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'pull request references must be unique', path: ['pullRequests'] })
})
export const CampaignExecutionReportSchema = z.object({ ...reportFields, checkpointFingerprint: z.string().length(64) }).strict().superRefine((report, context) => {
  const { checkpointFingerprint, ...payload } = report
  const result = CampaignExecutionPayloadSchema.safeParse(payload)
  if (!result.success) for (const issue of result.error.issues) context.addIssue(issue)
  if (checkpointFingerprint !== stableFingerprint(payload)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'campaign checkpoint fingerprint does not match', path: ['checkpointFingerprint'] })
})

export type CampaignExecutionEntry = z.infer<typeof CampaignExecutionEntrySchema>
export type CampaignExecutionReport = z.infer<typeof CampaignExecutionReportSchema>
export type CampaignPullRequestResult = Readonly<{ outcome: Exclude<PullRequestTerminalOutcome, 'SKIPPED' | 'CANCELLED'>; reason?: string }>

const sealReport = (raw: unknown): CampaignExecutionReport => {
  const payload = CampaignExecutionPayloadSchema.parse(JSON.parse(JSON.stringify(raw)))
  return CampaignExecutionReportSchema.parse({ ...payload, checkpointFingerprint: stableFingerprint(payload) })
}

const identityOf = (preflight: CampaignPreflightReport) => {
  const { generatedAt: _generatedAt, ...stablePreflight } = preflight
  return stableFingerprint({ packageVersion: packageVersion(), preflight: stablePreflight })
}
const stateFile = (root: string, campaignId: string) => join(root, 'campaigns', stableFingerprint(campaignId), 'execution.json')

function initialEntry(entry: CampaignPreflightEntry, at: string): CampaignExecutionEntry {
  const base = { ref: entry.ref, title: entry.title, author: entry.author, headRevision: entry.headRevision, attempts: 0 }
  if (entry.status === 'skipped') return CampaignExecutionEntrySchema.parse({ ...base, state: 'terminal', outcome: 'SKIPPED', reason: entry.reasons.join('; ') || 'not eligible', finishedAt: at })
  if (entry.status === 'blocked' || !entry.worktreeAllowed) return CampaignExecutionEntrySchema.parse({ ...base, state: 'terminal', outcome: 'BLOCKED', reason: entry.reasons.join('; ') || 'campaign preflight did not authorize execution', finishedAt: at })
  return CampaignExecutionEntrySchema.parse({ ...base, state: 'pending', outcome: null })
}

function terminalOutcome(entries: readonly CampaignExecutionEntry[], cancelled: boolean, preflightBlocked: boolean): z.infer<typeof CampaignTerminalOutcomeSchema> {
  if (cancelled || entries.some((entry) => entry.outcome === 'CANCELLED')) return 'CANCELLED'
  const blocked = entries.filter((entry) => entry.outcome === 'BLOCKED').length
  if (!entries.length && preflightBlocked) return 'BLOCKED'
  if (!blocked) return 'COMPLETE'
  return blocked === entries.length ? 'BLOCKED' : 'PARTIAL'
}

export function campaignReportDeliveryFailed(report: CampaignExecutionReport, error: string): CampaignExecutionReport {
  return sealReport({ ...report, checkpointFingerprint: undefined, state: 'running', outcome: null, finishedAt: undefined, error: `campaign report delivery failed: ${error}` })
}

export async function executeCampaign(input: {
  preflight: CampaignPreflightReport
  stateRoot: string
  execute: (entry: CampaignPreflightEntry, signal?: AbortSignal) => Promise<CampaignPullRequestResult>
  concurrency?: number
  continueAfterPerPrFailure?: boolean
  resume?: boolean
  campaignId?: string
  signal?: AbortSignal
  now?: () => Date
  leaseTtlMs?: number
  pullRequestLeaseTtlMs?: number
  leasePullRequests?: boolean
  onCheckpoint?: (report: CampaignExecutionReport) => void
}): Promise<CampaignExecutionReport> {
  const preflight = CampaignPreflightReportSchema.parse(input.preflight)
  const concurrency = Math.max(1, Math.min(16, input.concurrency ?? 1))
  const now = input.now ?? (() => new Date())
  const identityFingerprint = identityOf(preflight)
  const campaignId = input.campaignId ?? `campaign-${identityFingerprint.slice(0, 16)}`
  const file = stateFile(input.stateRoot, campaignId)
  let persisted: CampaignExecutionReport | undefined
  let persistedError: unknown
  if (input.resume !== false && existsSync(file)) {
    try { persisted = CampaignExecutionReportSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) }
    catch (error) { persistedError = error }
  }
  if (persisted && persisted.identityFingerprint !== identityFingerprint) throw new Error('campaign checkpoint identity is stale')
  if (persisted && stableFingerprint(persisted.pullRequests.map(({ ref, title, author, headRevision }) => ({ ref, title, author, headRevision }))) !== stableFingerprint(preflight.pullRequests.map(({ ref, title, author, headRevision }) => ({ ref, title, author, headRevision })))) throw new Error('campaign checkpoint pull-request manifest is stale')
  if (persisted?.state === 'terminal' && persisted.outcome !== terminalOutcome(persisted.pullRequests, false, preflight.status === 'blocked')) throw new Error('campaign checkpoint outcome is inconsistent')
  const createdAt = now().toISOString()
  if (persistedError) {
    const pullRequests = preflight.pullRequests.map((entry) => {
      const initial = initialEntry(entry, createdAt)
      return initial.state === 'terminal' ? initial : CampaignExecutionEntrySchema.parse({ ...initial, state: 'terminal', outcome: 'BLOCKED', reason: `campaign checkpoint: ${persistedError instanceof Error ? persistedError.message : String(persistedError)}`, finishedAt: createdAt })
    })
    return sealReport({ version: 1, campaignId, identityFingerprint, repository: preflight.repository, configFingerprint: preflight.configFingerprint, state: 'terminal', outcome: terminalOutcome(pullRequests, false, true), concurrency, startedAt: createdAt, updatedAt: createdAt, finishedAt: createdAt, pullRequests })
  }
  let report = persisted?.state === 'terminal' ? persisted : sealReport(persisted
    ? { ...persisted, checkpointFingerprint: undefined, pullRequests: persisted.pullRequests.map((entry) => entry.state === 'running' ? { ...entry, state: 'pending', outcome: null, reason: 'resumed after interrupted execution', finishedAt: undefined, durationMs: undefined } : entry), updatedAt: createdAt, error: undefined }
    : { version: 1, campaignId, identityFingerprint, repository: preflight.repository, configFingerprint: preflight.configFingerprint, state: 'running', outcome: null, concurrency, startedAt: createdAt, updatedAt: createdAt, pullRequests: preflight.pullRequests.map((entry) => initialEntry(entry, createdAt)) })
  if (report.state === 'terminal') return report

  const leaseTtlMs = Math.max(1_000, input.leaseTtlMs ?? 30_000)
  const pullRequestLeaseTtlMs = Math.max(leaseTtlMs, input.pullRequestLeaseTtlMs ?? leaseTtlMs)
  let stop = false
  let leaseFailure: unknown
  const abort = new AbortController()
  const executionSignal = input.signal ? AbortSignal.any([input.signal, abort.signal]) : abort.signal
  let lease: CampaignLease
  try {
    lease = acquireCampaignLease({ root: input.stateRoot, campaignId, identities: [], ownerId: randomUUID(), ttlMs: leaseTtlMs })
  } catch (error) {
    const finishedAt = now().toISOString()
    const pullRequests = report.pullRequests.map((entry) => entry.state === 'terminal' ? entry : CampaignExecutionEntrySchema.parse({ ...entry, state: 'terminal', outcome: 'BLOCKED', reason: `campaign lease: ${error instanceof Error ? error.message : String(error)}`, finishedAt }))
    return sealReport({ ...report, checkpointFingerprint: undefined, state: 'terminal', outcome: terminalOutcome(pullRequests, false, true), updatedAt: finishedAt, finishedAt, pullRequests })
  }
  const heartbeat = setInterval(() => { try { lease = renewCampaignLease(input.stateRoot, lease, leaseTtlMs) } catch (error) { leaseFailure = error; stop = true; abort.abort(error) } }, Math.max(250, Math.floor(leaseTtlMs / 3)))
  const save = () => { if (leaseFailure) throw leaseFailure; report = sealReport({ ...report, checkpointFingerprint: undefined, updatedAt: now().toISOString() }); writeLeasedJson(input.stateRoot, lease, file, report); input.onCheckpoint?.(report) }
  const preflightByRef = new Map(preflight.pullRequests.map((entry) => [`${entry.ref.repository}#${entry.ref.id}`, entry]))
  try {
    save()
    const pending = report.pullRequests.filter((entry) => entry.state === 'pending')
    let cursor = 0
    const worker = async () => {
      while (!stop && !executionSignal.aborted) {
        const queued = pending[cursor++]
        if (!queued) return
        const index = report.pullRequests.findIndex((entry) => entry.ref.repository === queued.ref.repository && entry.ref.id === queued.ref.id)
        let pullLease: CampaignLease | undefined
        try { if (input.leasePullRequests !== false) pullLease = acquireCampaignLease({ root: input.stateRoot, campaignId: `${campaignId}:${queued.ref.id}`, identities: [], pullRequests: [queued.ref], includeCampaign: false, ownerId: randomUUID(), ttlMs: pullRequestLeaseTtlMs }) }
        catch (error) {
          report.pullRequests[index] = CampaignExecutionEntrySchema.parse({ ...report.pullRequests[index], state: 'terminal', outcome: 'BLOCKED', reason: `pull-request lease: ${error instanceof Error ? error.message : String(error)}`, finishedAt: now().toISOString() })
          if (input.continueAfterPerPrFailure === false) stop = true
          save()
          continue
        }
        let pullLeaseFailure: unknown
        const pullAbort = new AbortController()
        const pullSignal = AbortSignal.any([executionSignal, pullAbort.signal])
        const pullHeartbeat = pullLease ? setInterval(() => { try { pullLease = renewCampaignLease(input.stateRoot, pullLease!, pullRequestLeaseTtlMs) } catch (error) { pullLeaseFailure = error; pullAbort.abort(error) } }, Math.max(250, Math.floor(pullRequestLeaseTtlMs / 3))) : undefined
        const started = now()
        try {
          report.pullRequests[index] = CampaignExecutionEntrySchema.parse({ ...report.pullRequests[index], state: 'running', outcome: null, attempts: report.pullRequests[index].attempts + 1, startedAt: started.toISOString(), finishedAt: undefined, durationMs: undefined })
          save()
          try {
            const source = preflightByRef.get(`${queued.ref.repository}#${queued.ref.id}`)
            if (!source) throw new Error('preflight entry is missing')
            const result = await input.execute(source, pullSignal)
            if (pullLeaseFailure) throw pullLeaseFailure
            const parsed = z.object({ outcome: PullRequestTerminalOutcomeSchema.exclude(['SKIPPED', 'CANCELLED']), reason: z.string().optional() }).strict().parse(result)
            const finished = now()
            report.pullRequests[index] = CampaignExecutionEntrySchema.parse({ ...report.pullRequests[index], state: 'terminal', outcome: parsed.outcome, ...(parsed.reason ? { reason: parsed.reason } : {}), finishedAt: finished.toISOString(), durationMs: Math.max(0, finished.getTime() - started.getTime()) })
          } catch (error) {
            const finished = now()
            report.pullRequests[index] = CampaignExecutionEntrySchema.parse({ ...report.pullRequests[index], state: 'terminal', outcome: pullSignal.aborted ? (executionSignal.aborted ? 'CANCELLED' : 'BLOCKED') : 'BLOCKED', reason: error instanceof Error ? error.message : String(error), finishedAt: finished.toISOString(), durationMs: Math.max(0, finished.getTime() - started.getTime()) })
            if (!pullSignal.aborted && input.continueAfterPerPrFailure === false) stop = true
          }
          save()
        } finally {
          clearInterval(pullHeartbeat)
          if (pullLease) releaseCampaignLease(input.stateRoot, pullLease)
        }
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker().catch((error) => { abort.abort(error); throw error }))
    const settled = await Promise.allSettled(workers)
    const failedWorker = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failedWorker) throw failedWorker.reason
    const cancelled = Boolean(input.signal?.aborted)
    report.pullRequests = report.pullRequests.map((entry) => entry.state === 'pending'
      ? CampaignExecutionEntrySchema.parse({ ...entry, state: 'terminal', outcome: 'CANCELLED', reason: cancelled ? 'campaign cancelled' : 'campaign stopped after a pull-request failure', finishedAt: now().toISOString() })
      : entry)
    report = sealReport({ ...report, checkpointFingerprint: undefined, state: 'terminal', outcome: terminalOutcome(report.pullRequests, cancelled, preflight.status === 'blocked'), finishedAt: now().toISOString(), updatedAt: now().toISOString() })
    save()
    return report
  } catch (error) {
    return sealReport({ ...report, checkpointFingerprint: undefined, state: 'running', outcome: null, finishedAt: undefined, updatedAt: now().toISOString(), error: `campaign state was not durably committed: ${error instanceof Error ? error.message : String(error)}` })
  } finally { clearInterval(heartbeat); try { releaseCampaignLease(input.stateRoot, lease) } catch { /* expired leases are reclaimed on the next run */ } }
}
