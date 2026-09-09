import { z } from 'zod'

const identifier = z.string().min(1).max(200)
const revision = z.string().min(4).max(128)

export const ScmCapabilitySchema = z.enum([
  'discovery', 'metadata', 'diff', 'file-content', 'review-state', 'publish-review', 'merge-readiness', 'merge',
])
export type ScmCapability = z.infer<typeof ScmCapabilitySchema>

export const ScmCapabilitiesSchema = z.record(ScmCapabilitySchema, z.boolean()).readonly()
export type ScmCapabilities = z.infer<typeof ScmCapabilitiesSchema>

export const ChangeRequestRefSchema = z.object({
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  id: identifier,
}).strict().readonly()

export const ChangeRequestQuerySchema = z.object({
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  state: z.enum(['open', 'closed', 'all']).default('open'),
  authors: z.array(identifier).default([]),
  excludeAuthors: z.array(identifier).default([]),
  labels: z.array(identifier).default([]),
}).strict().readonly()

export const ChangeRequestMetadataSchema = z.object({
  ref: ChangeRequestRefSchema,
  title: z.string().min(1).max(1_000),
  state: z.enum(['open', 'closed']),
  author: identifier,
  sourceRevision: revision,
  targetRevision: revision,
  sourceBranch: identifier,
  targetBranch: identifier,
  isDraft: z.boolean(),
  isFork: z.boolean(),
  labels: z.array(identifier),
  updatedAt: z.string().datetime(),
}).strict().readonly()

export const ChangeRequestDiffSchema = z.object({
  baseRevision: revision,
  headRevision: revision,
  complete: z.boolean(),
  files: z.array(z.object({
    path: z.string().min(1).max(4_096),
    previousPath: z.string().min(1).max(4_096).optional(),
    status: z.enum(['added', 'modified', 'removed', 'renamed', 'copied']),
    patch: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().default(false),
  }).strict().readonly()),
}).strict().readonly()

export const ScmFileContentSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
}).strict().readonly()

export const ScmReviewStateSchema = z.object({
  headRevision: revision,
  fingerprint: identifier,
  alreadyPublished: z.boolean(),
  scope: z.enum(['full', 'incremental']),
  baselineRevision: revision.nullable(),
}).strict().readonly()

export const ScmReviewPublicationSchema = z.object({
  channel: z.enum(['review', 'summary']),
  headRevision: revision,
  fingerprint: identifier.optional(),
  verdict: z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
  summary: z.string().max(65_536),
  annotations: z.array(z.object({
    path: z.string().min(1).max(4_096),
    line: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    body: z.string().min(1).max(65_536),
  }).strict().readonly()),
}).strict().readonly()

export const ScmPublicationReceiptSchema = z.object({
  id: identifier,
  url: z.string().url().optional(),
}).strict().readonly()

export const ScmMergeReadinessSchema = z.object({
  headRevision: revision,
  ready: z.boolean(),
  blockers: z.array(z.string().min(1).max(1_000)),
}).strict().superRefine((value, context) => {
  if (value.ready === (value.blockers.length > 0)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'ready merge requests cannot have blockers' })
}).readonly()

export const ScmMergeRequestSchema = z.object({
  expectedHeadRevision: revision,
  method: z.enum(['merge', 'squash', 'rebase']),
  admin: z.boolean().default(false),
}).strict().readonly()

export const ScmMergeReceiptSchema = z.object({
  revision,
  mergedAt: z.string().datetime(),
}).strict().readonly()

export type ChangeRequestRef = z.infer<typeof ChangeRequestRefSchema>
export type ChangeRequestQuery = z.infer<typeof ChangeRequestQuerySchema>
export type ChangeRequestMetadata = z.infer<typeof ChangeRequestMetadataSchema>
export type ChangeRequestDiff = z.infer<typeof ChangeRequestDiffSchema>
export type ScmFileContent = z.infer<typeof ScmFileContentSchema>
export type ScmReviewState = z.infer<typeof ScmReviewStateSchema>
export type ScmReviewPublication = z.infer<typeof ScmReviewPublicationSchema>
export type ScmPublicationReceipt = z.infer<typeof ScmPublicationReceiptSchema>
export type ScmMergeReadiness = z.infer<typeof ScmMergeReadinessSchema>
export type ScmMergeRequest = z.infer<typeof ScmMergeRequestSchema>
export type ScmMergeReceipt = z.infer<typeof ScmMergeReceiptSchema>

export interface ScmAdapter {
  readonly id: string
  readonly capabilities: ScmCapabilities
  discover(query: ChangeRequestQuery): Promise<readonly ChangeRequestRef[]>
  metadata(ref: ChangeRequestRef): Promise<ChangeRequestMetadata>
  diff(ref: ChangeRequestRef, baselineRevision?: string): Promise<ChangeRequestDiff>
  fileContent(ref: ChangeRequestRef, path: string, revision: string, maxBytes: number): Promise<ScmFileContent>
  reviewState(ref: ChangeRequestRef, fingerprint: string): Promise<ScmReviewState>
  publishReview(ref: ChangeRequestRef, review: ScmReviewPublication): Promise<ScmPublicationReceipt>
  mergeReadiness(ref: ChangeRequestRef): Promise<ScmMergeReadiness>
  merge(ref: ChangeRequestRef, request: ScmMergeRequest): Promise<ScmMergeReceipt>
}

export class UnsupportedScmCapabilityError extends Error {
  constructor(readonly adapterId: string, readonly capability: ScmCapability) {
    super(`SCM adapter ${adapterId} does not support ${capability}`)
    this.name = 'UnsupportedScmCapabilityError'
  }
}

export function requireScmCapability(adapter: Pick<ScmAdapter, 'id' | 'capabilities'>, capability: ScmCapability): void {
  if (!adapter.capabilities[capability]) throw new UnsupportedScmCapabilityError(adapter.id, capability)
}
