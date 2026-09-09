import { existsSync, readFileSync } from 'node:fs'
import { MemoryError } from '@agentskit/core'
import { z } from 'zod'
import { writeAtomicJson } from './campaign-store.js'
import { ReviewFeedbackSchema, ReviewSafeTextSchema, type ReviewFeedback } from './review-stores.js'
import { stableFingerprint } from './stable-fingerprint.js'

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const date = z.string().datetime()
const outcome = z.enum(['accepted', 'rejected', 'fixed', 'unresolved', 'obsolete', 'pending'])

const outcomeCounts = z.object({ accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), fixed: z.number().int().nonnegative(), unresolved: z.number().int().nonnegative(), obsolete: z.number().int().nonnegative(), pending: z.number().int().nonnegative() }).strict().readonly()
const evidence = z.object({
  feedbackId: fingerprint,
  repository: z.string().min(1).max(200),
  pullNumber: z.number().int().positive(),
  headSha: z.string().min(1).max(200),
  finding: z.object({ file: z.string().min(1).max(500), line: z.number().int().positive(), title: ReviewSafeTextSchema }).strict(),
  status: outcome,
  observedAt: date,
}).strict().readonly()

export const ReviewCandidateRuleSchema = z.object({
  version: z.literal(1),
  id: fingerprint,
  status: z.literal('candidate'),
  active: z.literal(false),
  requiresApproval: z.literal(true),
  rule: ReviewSafeTextSchema.refine((value) => value.length <= 500, 'must contain at most 500 characters'),
  repository: z.string().min(1).max(200),
  evidenceCount: z.number().int().nonnegative(),
  evidence: z.array(evidence).min(2).max(200).readonly(),
  outcomeCounts,
  firstSeenAt: date,
  lastSeenAt: date,
}).strict().readonly()

export type ReviewCandidateRule = z.infer<typeof ReviewCandidateRuleSchema>

export const ReviewReconciliationMetricsSchema = z.object({
  feedbackEntries: z.number().int().nonnegative(),
  uniqueFeedbackEntries: z.number().int().nonnegative(),
  processedFeedbackEntries: z.number().int().nonnegative(),
  duplicateEntries: z.number().int().nonnegative(),
  supportingEvidence: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  activeRulesCreated: z.literal(0),
  outcomeCounts,
}).strict().readonly()

export const ReviewReconciliationReportSchema = z.object({
  version: z.literal(1),
  inputFingerprint: fingerprint,
  processedFeedbackIds: z.array(fingerprint).readonly(),
  supportingEvidence: z.array(evidence).readonly(),
  metrics: ReviewReconciliationMetricsSchema,
  candidates: z.array(ReviewCandidateRuleSchema).readonly(),
  updatedAt: date,
}).strict().readonly()

export type ReviewReconciliationReport = z.infer<typeof ReviewReconciliationReportSchema>
export type ReviewReconciliationMetrics = z.infer<typeof ReviewReconciliationMetricsSchema>

export type ReviewReconciliationStore = Readonly<{
  path: string
  load: () => Promise<ReviewReconciliationReport | undefined>
  save: (report: ReviewReconciliationReport) => Promise<void>
}>

const emptyOutcomeCounts = () => ({ accepted: 0, rejected: 0, fixed: 0, unresolved: 0, obsolete: 0, pending: 0 })
const findingKey = (entry: { repository: string; finding: Pick<ReviewFeedback['finding'], 'file' | 'line' | 'title'> }) => stableFingerprint({ repository: entry.repository, finding: { file: entry.finding.file, line: entry.finding.line, title: entry.finding.title } })

function error(message: string, cause?: unknown): MemoryError {
  return new MemoryError({ code: 'AK_MEMORY_LOAD_FAILED', message, hint: 'Repair or remove the repository-local reconciliation checkpoint and retry.', cause })
}

function parseCheckpoint(path: string): ReviewReconciliationReport {
  try { return ReviewReconciliationReportSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) }
  catch (cause) { throw error(`review reconciliation checkpoint is malformed: ${path}`, cause) }
}

export function createReviewReconciliationStore(path: string): ReviewReconciliationStore {
  return {
    path,
    load: async () => existsSync(path) ? parseCheckpoint(path) : undefined,
    save: async (report) => {
      try { writeAtomicJson(path, ReviewReconciliationReportSchema.parse(report)) }
      catch (cause) { throw error(`unable to write review reconciliation checkpoint: ${path}`, cause) }
    },
  }
}

export function reconcileReviewFeedback(feedback: readonly ReviewFeedback[], previous?: ReviewReconciliationReport): ReviewReconciliationReport {
  const entries = ReviewFeedbackSchema.array().parse(feedback)
  const unique = [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((left, right) => left.id.localeCompare(right.id))
  const processed = new Set(previous?.processedFeedbackIds ?? [])
  for (const id of processed) if (!unique.some((entry) => entry.id === id)) throw new Error(`reconciliation checkpoint references missing feedback: ${id}`)
  const metrics = previous ? { ...previous.metrics, outcomeCounts: { ...previous.metrics.outcomeCounts } } : { feedbackEntries: 0, uniqueFeedbackEntries: 0, processedFeedbackEntries: 0, duplicateEntries: 0, supportingEvidence: 0, candidateCount: 0, activeRulesCreated: 0 as const, outcomeCounts: emptyOutcomeCounts() }
  metrics.feedbackEntries = entries.length
  metrics.uniqueFeedbackEntries = unique.length
  metrics.duplicateEntries = entries.length - unique.length
  const supporting = [...new Map([...(previous?.supportingEvidence ?? []), ...unique.filter((item) => ['accepted', 'fixed'].includes(item.finding.status)).map((item) => ({ feedbackId: item.id, repository: item.repository, pullNumber: item.pullNumber, headSha: item.headSha, finding: { file: item.finding.file, line: item.finding.line, title: item.finding.title }, status: item.finding.status, observedAt: item.createdAt }))].map((item) => [item.feedbackId, item])).values()].sort((left, right) => left.feedbackId.localeCompare(right.feedbackId))
  for (const entry of unique.filter((item) => !processed.has(item.id))) {
    processed.add(entry.id)
    metrics.processedFeedbackEntries += 1
    metrics.outcomeCounts[entry.finding.status] += 1
  }
  metrics.supportingEvidence = supporting.length
  const groups = new Map<string, typeof supporting>()
  for (const item of supporting) {
    const key = findingKey(item)
    const existing = groups.get(key) ?? []
    groups.set(key, [...existing, item])
  }
  const resultCandidates = [...groups.entries()].flatMap(([id, observations]) => {
    if (observations.length < 2) return []
    const counts = emptyOutcomeCounts()
    for (const item of observations) counts[item.status] += 1
    return [ReviewCandidateRuleSchema.parse({ version: 1, id, status: 'candidate', active: false, requiresApproval: true, rule: observations[0].finding.title, repository: observations[0].repository, evidenceCount: observations.length, evidence: observations, outcomeCounts: counts, firstSeenAt: observations[0].observedAt, lastSeenAt: observations.at(-1)?.observedAt })]
  }).sort((left, right) => left.id.localeCompare(right.id))
  metrics.candidateCount = resultCandidates.length
  return ReviewReconciliationReportSchema.parse({ version: 1, inputFingerprint: stableFingerprint(unique), processedFeedbackIds: [...processed].sort(), supportingEvidence: supporting, metrics, candidates: resultCandidates, updatedAt: new Date().toISOString() })
}
