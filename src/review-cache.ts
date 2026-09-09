import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeAtomicJson } from './campaign-store.js'
import { stableFingerprint } from './stable-fingerprint.js'

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)

export const ReviewCacheIdentitySchema = z.object({
  sourceFingerprint: fingerprint,
  diffFingerprint: fingerprint,
  baseFingerprint: fingerprint,
  policyFingerprint: fingerprint,
  promptFingerprint: fingerprint,
  modelFingerprint: fingerprint,
  knowledgeFingerprint: fingerprint,
}).strict().readonly()

export type ReviewCacheIdentity = z.infer<typeof ReviewCacheIdentitySchema>

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningOutputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative(),
  providerCalls: z.number().int().nonnegative(),
}).strict().readonly()

const validationSchema = z.object({
  status: z.enum(['passed', 'failed']),
  checkedAt: z.string().datetime(),
  evidenceFingerprint: fingerprint,
}).strict().readonly()

const provenanceSchema = z.object({
  repository: z.string().min(1),
  pullNumber: z.number().int().positive().optional(),
  unitId: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)).readonly(),
  sourceRevision: z.string().min(1),
  createdAt: z.string().datetime(),
}).strict().readonly()

export const ReviewCacheRecordSchema = z.object({
  version: z.literal(1),
  key: fingerprint,
  identity: ReviewCacheIdentitySchema,
  provenance: provenanceSchema,
  tokenUsage: tokenUsageSchema,
  validation: validationSchema,
  value: z.unknown(),
  createdAt: z.string().datetime(),
}).strict().readonly()

export type ReviewCacheRecord = z.infer<typeof ReviewCacheRecordSchema>
export type ReviewCacheMissReason = 'missing' | 'corrupt' | 'stale' | 'unvalidated'
export type ReviewCacheLookup =
  | { hit: true; record: ReviewCacheRecord }
  | { hit: false; reason: ReviewCacheMissReason }

export type ReviewCacheWrite = Omit<ReviewCacheRecord, 'version' | 'key' | 'identity' | 'createdAt'> & { createdAt?: string }

export type ReviewCache = Readonly<{
  get(identity: ReviewCacheIdentity): ReviewCacheLookup
  set(identity: ReviewCacheIdentity, input: ReviewCacheWrite): ReviewCacheRecord
  pathFor(identity: ReviewCacheIdentity): string
}>

export function reviewCacheKey(identity: ReviewCacheIdentity): string {
  return stableFingerprint(ReviewCacheIdentitySchema.parse(identity))
}

export function createReviewCache(root: string): ReviewCache {
  const pathFor = (identity: ReviewCacheIdentity) => join(root, `${reviewCacheKey(identity)}.json`)

  const get = (identity: ReviewCacheIdentity): ReviewCacheLookup => {
    const parsedIdentity = ReviewCacheIdentitySchema.safeParse(identity)
    if (!parsedIdentity.success) return { hit: false, reason: 'corrupt' }
    const file = pathFor(parsedIdentity.data)
    if (!existsSync(file)) return { hit: false, reason: 'missing' }
    let record: ReviewCacheRecord
    try { record = ReviewCacheRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) }
    catch { return { hit: false, reason: 'corrupt' } }
    if (record.key !== reviewCacheKey(parsedIdentity.data) || stableFingerprint(record.identity) !== stableFingerprint(parsedIdentity.data)) return { hit: false, reason: 'stale' }
    if (record.validation.status !== 'passed') return { hit: false, reason: 'unvalidated' }
    return { hit: true, record }
  }

  const set = (identity: ReviewCacheIdentity, input: ReviewCacheWrite): ReviewCacheRecord => {
    const parsedIdentity = ReviewCacheIdentitySchema.parse(identity)
    const record = ReviewCacheRecordSchema.parse({ version: 1, key: reviewCacheKey(parsedIdentity), identity: parsedIdentity, ...input, createdAt: input.createdAt ?? new Date().toISOString() })
    writeAtomicJson(pathFor(parsedIdentity), record)
    return record
  }

  return { get, set, pathFor }
}
