import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { stableFingerprint } from './stable-fingerprint.js'

const nonNegative = z.number().finite().nonnegative()
const measured = nonNegative.nullable()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const repository = z.string().regex(/^[^/\s]+\/[^/\s]+$/)
const sha = z.string().regex(/^[a-f0-9]{7,64}$/i)

export const QualityBaselineIdentitySchema = z.object({
  libraryVersion: z.string().min(1),
  sourceRevision: z.string().min(1),
  policyFingerprint: fingerprint,
  promptFingerprint: fingerprint,
  model: z.string().min(1),
}).strict()

export const QualityTokenBreakdownSchema = z.object({
  input: measured,
  cachedInput: measured,
  output: measured,
  reasoning: measured,
  memory: measured,
  retry: measured,
  total: measured,
}).strict()

export const QualityDurationBreakdownSchema = z.object({
  wallClockMs: nonNegative,
  preflightMs: measured,
  providerMs: measured,
  verificationMs: measured,
  publishingMs: measured,
  mergeMs: measured,
}).strict()

const syntheticEvidence = z.object({
  origin: z.literal('synthetic'),
  fixtureId: z.string().min(1),
  fingerprint,
}).strict()

const realEvidence = z.object({
  origin: z.literal('real'),
  repository,
  pullNumber: z.number().int().positive().optional(),
  headSha: sha.optional(),
  fingerprint,
}).strict()

const outcome = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'BLOCKED', 'SKIPPED', 'MERGED', 'CANCELLED'])
const commonRun = {
  runId: z.string().min(1),
  outcome,
  tokens: QualityTokenBreakdownSchema,
  duration: QualityDurationBreakdownSchema,
}

export const SyntheticRunBaselineSchema = z.object({
  kind: z.literal('synthetic-run'),
  ...commonRun,
  fixtureId: z.string().min(1),
  evidence: syntheticEvidence,
}).strict().superRefine((run, context) => {
  if (run.fixtureId !== run.evidence.fixtureId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'fixture identity does not match its evidence', path: ['evidence', 'fixtureId'] })
})

export const RealRunBaselineSchema = z.object({
  kind: z.literal('real-run'),
  ...commonRun,
  repository,
  pullNumber: z.number().int().positive(),
  headSha: sha,
  evidence: realEvidence,
}).strict().superRefine((run, context) => {
  if (run.repository !== run.evidence.repository || run.pullNumber !== run.evidence.pullNumber || run.headSha !== run.evidence.headSha) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'real run identity does not match its evidence', path: ['evidence'] })
  }
})

export const RealCampaignBaselineSchema = z.object({
  kind: z.literal('real-campaign'),
  campaignId: z.string().min(1),
  discovered: z.number().int().nonnegative(),
  terminal: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  tokens: QualityTokenBreakdownSchema,
  duration: QualityDurationBreakdownSchema,
  evidence: realEvidence,
}).strict().superRefine((campaign, context) => {
  if (campaign.terminal > campaign.discovered) context.addIssue({ code: z.ZodIssueCode.custom, message: 'terminal runs cannot exceed discovered runs', path: ['terminal'] })
  if (campaign.completed + campaign.blocked > campaign.terminal) context.addIssue({ code: z.ZodIssueCode.custom, message: 'completed and blocked runs cannot exceed terminal runs', path: ['completed'] })
})

export const QualityBaselineSchema = z.object({
  schemaVersion: z.literal(2),
  baselineId: fingerprint,
  identity: QualityBaselineIdentitySchema,
  syntheticRuns: z.array(SyntheticRunBaselineSchema),
  realRuns: z.array(RealRunBaselineSchema),
  realCampaigns: z.array(RealCampaignBaselineSchema),
}).strict().superRefine((baseline, context) => {
  if (baseline.baselineId !== qualityBaselineIdentity(baseline.identity)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'baselineId does not match the normalized identity', path: ['baselineId'] })
  }
})

export type QualityBaselineIdentity = z.infer<typeof QualityBaselineIdentitySchema>
export type QualityTokenBreakdown = z.infer<typeof QualityTokenBreakdownSchema>
export type QualityDurationBreakdown = z.infer<typeof QualityDurationBreakdownSchema>
export type QualityBaseline = z.infer<typeof QualityBaselineSchema>

export function qualityBaselineIdentity(input: QualityBaselineIdentity): string {
  return stableFingerprint(QualityBaselineIdentitySchema.parse(input))
}

export function parseQualityBaseline(input: unknown): QualityBaseline {
  const result = QualityBaselineSchema.safeParse(input)
  if (!result.success) throw new Error(`invalid quality baseline: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  return result.data
}

/** Study evidence is intentionally external to the source tree and package payload. */
export function validateStudyOutputPath(output: string, repositoryRoot: string): string {
  const root = resolve(repositoryRoot)
  const target = resolve(output)
  const child = relative(root, target)
  if (!isAbsolute(child) && child !== '' && !child.startsWith('..')) throw new Error('quality study output must be outside the repository')
  if (child === '') throw new Error('quality study output must be a file outside the repository')
  return target
}
