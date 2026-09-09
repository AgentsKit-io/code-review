import { z } from 'zod'
import { stableFingerprint } from './stable-fingerprint.js'

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const sha = z.string().regex(/^[a-f0-9]{40,64}$/i)
const identifier = z.string().min(1).max(200)

export const CampaignTerminalOutcomeSchema = z.enum(['COMPLETE', 'PARTIAL', 'BLOCKED', 'CANCELLED'])
export const PullRequestTerminalOutcomeSchema = z.enum(['SKIPPED', 'BLOCKED', 'APPROVED', 'CHANGES_REQUESTED', 'MERGE_BLOCKED', 'MERGED', 'CANCELLED'])
export const FailureDispositionSchema = z.enum(['TERMINAL', 'RETRYABLE', 'REPLANNABLE', 'CANCELLED'])

export const ReviewIdentitySchema = z.object({
  version: z.literal(1),
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  pullNumber: z.number().int().positive(),
  headSha: sha,
  baseSha: sha,
  policyFingerprint: fingerprint,
  promptFingerprint: fingerprint,
  configurationFingerprint: fingerprint,
  model: z.object({ provider: identifier, name: identifier }).strict().readonly(),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
}).strict().readonly()

export const ExecutionBudgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxCalls: z.number().int().positive(),
  deadlineMs: z.number().int().positive(),
}).strict().readonly()

export const BudgetEnvelopeSchema = z.object({
  campaign: ExecutionBudgetSchema,
  pullRequest: ExecutionBudgetSchema,
  contextPack: ExecutionBudgetSchema,
  analysis: ExecutionBudgetSchema,
  verification: ExecutionBudgetSchema,
}).strict().readonly()

const failureBase = {
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  operation: identifier,
  message: z.string().min(1).max(2_000),
}
export const DomainFailureSchema = z.discriminatedUnion('disposition', [
  z.object({ disposition: z.literal('TERMINAL'), ...failureBase }).strict(),
  z.object({ disposition: z.literal('RETRYABLE'), ...failureBase, retryAfterMs: z.number().int().nonnegative() }).strict(),
  z.object({ disposition: z.literal('REPLANNABLE'), ...failureBase, replanReason: identifier }).strict(),
  z.object({ disposition: z.literal('CANCELLED'), ...failureBase }).strict(),
])

export const CampaignContractSchema = z.object({
  version: z.literal(1),
  campaignId: identifier,
  state: z.enum(['PLANNED', 'RUNNING', 'TERMINAL']),
  outcome: CampaignTerminalOutcomeSchema.nullable(),
  pullRequestRunIds: z.array(identifier),
  budgets: BudgetEnvelopeSchema,
  createdAt: z.string().datetime(),
}).strict().superRefine((campaign, context) => {
  if ((campaign.state === 'TERMINAL') !== (campaign.outcome !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'only terminal campaigns have an outcome', path: ['outcome'] })
}).readonly()

export const PullRequestRunContractSchema = z.object({
  version: z.literal(1),
  runId: identifier,
  campaignId: identifier,
  state: z.enum(['DISCOVERED', 'ELIGIBLE', 'PREFLIGHTED', 'PLANNED', 'RUNNING', 'TERMINAL']),
  outcome: PullRequestTerminalOutcomeSchema.nullable(),
  identity: ReviewIdentitySchema,
  budget: ExecutionBudgetSchema,
}).strict().superRefine((run, context) => {
  if ((run.state === 'TERMINAL') !== (run.outcome !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'only terminal pull-request runs have an outcome', path: ['outcome'] })
}).readonly()

export const ReviewUnitContractSchema = z.object({
  version: z.literal(1),
  unitId: identifier,
  runId: identifier,
  kind: z.enum(['STATIC_EVIDENCE', 'CONTEXT_PACK', 'ANALYSIS', 'VERIFICATION']),
  state: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  identityFingerprint: fingerprint,
  attempt: z.number().int().nonnegative(),
  budget: ExecutionBudgetSchema,
}).strict().readonly()

const eventPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CAMPAIGN_STARTED') }).strict(),
  z.object({ type: z.literal('PULL_REQUEST_REGISTERED'), run: PullRequestRunContractSchema }).strict(),
  z.object({ type: z.literal('REVIEW_UNIT_PLANNED'), unit: ReviewUnitContractSchema }).strict(),
  z.object({ type: z.literal('REVIEW_UNIT_COMPLETED'), unitId: identifier, evidenceFingerprint: fingerprint }).strict(),
  z.object({ type: z.literal('REVIEW_UNIT_FAILED'), unitId: identifier, failure: DomainFailureSchema }).strict(),
  z.object({ type: z.literal('PULL_REQUEST_TERMINATED'), runId: identifier, outcome: PullRequestTerminalOutcomeSchema }).strict(),
  z.object({ type: z.literal('CAMPAIGN_TERMINATED'), outcome: CampaignTerminalOutcomeSchema }).strict(),
  z.object({ type: z.literal('CANCELLATION_REQUESTED'), reason: identifier }).strict(),
])

export const CampaignEventSchema = z.object({
  version: z.literal(1),
  eventId: identifier,
  campaignId: identifier,
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  payload: eventPayload,
}).strict().readonly()

export type CampaignTerminalOutcome = z.infer<typeof CampaignTerminalOutcomeSchema>
export type PullRequestTerminalOutcome = z.infer<typeof PullRequestTerminalOutcomeSchema>
export type FailureDisposition = z.infer<typeof FailureDispositionSchema>
export type ReviewIdentity = z.infer<typeof ReviewIdentitySchema>
export type ExecutionBudget = z.infer<typeof ExecutionBudgetSchema>
export type BudgetEnvelope = z.infer<typeof BudgetEnvelopeSchema>
export type DomainFailure = z.infer<typeof DomainFailureSchema>
export type CampaignContract = z.infer<typeof CampaignContractSchema>
export type PullRequestRunContract = z.infer<typeof PullRequestRunContractSchema>
export type ReviewUnitContract = z.infer<typeof ReviewUnitContractSchema>
export type CampaignEvent = z.infer<typeof CampaignEventSchema>

export function reviewIdentityFingerprint(input: ReviewIdentity): string {
  return stableFingerprint(ReviewIdentitySchema.parse(input))
}
