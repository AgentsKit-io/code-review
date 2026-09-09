import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryError, type RetrievedDocument, type Retriever } from '@agentskit/core'
import { z } from 'zod'
import { writeAtomicJson } from './campaign-store.js'
import { stableFingerprint } from './stable-fingerprint.js'

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
export const ReviewSafeTextSchema = z.string().trim().min(1).max(1_000).refine(
  (value) => !/(?:-----BEGIN [^-]+ PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|npm_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|AKIA[0-9A-Z]{16}))/i.test(value),
  'must not contain a credential or private key',
)
const safeText = ReviewSafeTextSchema
const date = z.string().datetime()
const reviewCategory = z.enum(['correctness', 'security', 'performance', 'maintainability', 'design', 'tests', 'conventions'])
const relativePath = z.string().trim().min(1).max(500).refine(
  (value) => !value.startsWith('/') && !value.startsWith('\\') && !/^[A-Za-z]:[\\/]/.test(value) && !value.split('/').includes('..') && !value.split('\\').includes('..'),
  'must be repository-relative and cannot contain ..',
)

export const ReviewKnowledgeScopeSchema = z.object({
  repository: z.string().trim().min(1).max(200).optional(),
  paths: z.array(relativePath).max(100).optional(),
  languages: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  categories: z.array(reviewCategory).max(7).optional(),
  maxRules: z.number().int().min(1).max(20).default(20),
  maxTokens: z.number().int().min(1).max(8_000).default(2_000),
}).strict().readonly()

export type ReviewKnowledgeScope = z.infer<typeof ReviewKnowledgeScopeSchema>
export type ReviewKnowledgeScopeInput = z.input<typeof ReviewKnowledgeScopeSchema>

export const ReviewStoreLayoutSchema = z.object({
  version: z.literal(1),
  root: z.string().min(1),
  operationalStatePath: z.string().min(1),
  cachePath: z.string().min(1),
  feedbackPath: z.string().min(1),
  knowledgePath: z.string().min(1),
}).strict().readonly()

export type ReviewStoreLayout = z.infer<typeof ReviewStoreLayoutSchema>

export const ReviewFeedbackSchema = z.object({
  version: z.literal(1),
  id: fingerprint,
  runId: z.string().min(1).max(200),
  repository: z.string().min(1).max(200),
  pullNumber: z.number().int().positive(),
  headSha: z.string().min(1).max(200),
  finding: z.object({
    file: z.string().min(1).max(500),
    line: z.number().int().positive(),
    title: safeText,
    status: z.enum(['accepted', 'rejected', 'fixed', 'unresolved', 'obsolete', 'pending']),
  }).strict(),
  createdAt: date,
}).strict().readonly()

export const ReviewFeedbackFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(ReviewFeedbackSchema).readonly(),
}).strict().readonly()

export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>

export const ReviewKnowledgeSchema = z.object({
  version: z.literal(1),
  id: fingerprint,
  kind: z.literal('approved-rule'),
  rule: safeText.refine((value) => value.length <= 500, 'must contain at most 500 characters'),
  repository: z.string().min(1).max(200).optional(),
  path: relativePath.optional(),
  language: z.string().trim().min(1).max(40).optional(),
  category: reviewCategory.optional(),
  createdAt: date,
}).strict().readonly()

export const ReviewKnowledgeFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(ReviewKnowledgeSchema).readonly(),
}).strict().readonly()

export type ReviewKnowledge = z.infer<typeof ReviewKnowledgeSchema>

export type ReviewFeedbackStore = Readonly<{
  path: string
  load: () => Promise<ReviewFeedback[]>
  append: (entry: Omit<ReviewFeedback, 'version' | 'id' | 'createdAt'> & { createdAt?: string }) => Promise<ReviewFeedback>
  size: () => Promise<number>
}>

export type ReviewKnowledgeStore = Readonly<{
  path: string
  load: () => Promise<ReviewKnowledge[]>
  approvedRules: (scope?: ReviewKnowledgeScopeInput) => Promise<string[]>
  saveApprovedRule: (input: { rule: string; repository?: string; path?: string; language?: string; category?: z.infer<typeof reviewCategory>; createdAt?: string }) => Promise<ReviewKnowledge>
}>

const locks = new Map<string, Promise<unknown>>()

async function withPathLock<T>(path: string, operation: () => T | Promise<T>): Promise<T> {
  const key = resolve(path)
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease })
  const next = previous.catch(() => {}).then(() => current)
  locks.set(key, next)
  await previous.catch(() => {})
  try { return await operation() } finally {
    release()
    if (locks.get(key) === next) locks.delete(key)
  }
}

function storeError(message: string, cause?: unknown): MemoryError {
  return new MemoryError({ code: 'AK_MEMORY_LOAD_FAILED', message, hint: 'Repair or remove the repository-local store and retry.', cause })
}

function readFile<T>(path: string, schema: z.ZodType<T>, empty: T): T {
  if (!existsSync(path)) return empty
  try {
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error instanceof MemoryError) throw error
    throw storeError(`review store is malformed: ${path}`, error)
  }
}

function writeFile<T>(path: string, schema: z.ZodType<T>, value: T): void {
  try { writeAtomicJson(path, schema.parse(value)) }
  catch (error) { throw storeError(`unable to write review store: ${path}`, error) }
}

export function createReviewStoreLayout(root: string): ReviewStoreLayout {
  const resolved = resolve(root)
  return ReviewStoreLayoutSchema.parse({
    version: 1,
    root: resolved,
    operationalStatePath: `${resolved}/state`,
    cachePath: `${resolved}/cache`,
    feedbackPath: `${resolved}/feedback.json`,
    knowledgePath: `${resolved}/knowledge.json`,
  })
}

export function createReviewFeedbackStore(path: string, retentionDays = 365): ReviewFeedbackStore {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000
  const empty = { version: 1 as const, entries: [] as ReviewFeedback[] }
  const load = async (): Promise<ReviewFeedback[]> => [...(await withPathLock(path, () => readFile(path, ReviewFeedbackFileSchema, empty))).entries]
  const append = async (input: Omit<ReviewFeedback, 'version' | 'id' | 'createdAt'> & { createdAt?: string }): Promise<ReviewFeedback> => withPathLock(path, () => {
    const current = readFile(path, ReviewFeedbackFileSchema, empty)
    const entry = ReviewFeedbackSchema.parse({ version: 1, id: stableFingerprint(input), ...input, createdAt: input.createdAt ?? new Date().toISOString() })
    const entries = [...current.entries, entry].filter((item) => Date.parse(item.createdAt) >= cutoff).slice(-2_000)
    writeFile(path, ReviewFeedbackFileSchema, { version: 1, entries })
    return entry
  })
  return { path, load, append, size: async () => (await load()).length }
}

export function createReviewKnowledgeStore(path: string, retentionDays = 365): ReviewKnowledgeStore {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000
  const empty = { version: 1 as const, entries: [] as ReviewKnowledge[] }
  const load = async (): Promise<ReviewKnowledge[]> => [...(await withPathLock(path, () => readFile(path, ReviewKnowledgeFileSchema, empty))).entries]
  const approvedRules = async (scope?: ReviewKnowledgeScopeInput): Promise<string[]> => [...new Set(selectKnowledge(await load(), scope).map((entry) => entry.rule))]
  const saveApprovedRule = async (input: { rule: string; repository?: string; path?: string; language?: string; category?: z.infer<typeof reviewCategory>; createdAt?: string }): Promise<ReviewKnowledge> => withPathLock(path, () => {
    const current = readFile(path, ReviewKnowledgeFileSchema, empty)
    const entry = ReviewKnowledgeSchema.parse({ version: 1, id: stableFingerprint(input), kind: 'approved-rule', ...input, createdAt: input.createdAt ?? new Date().toISOString() })
    const entries = [...current.entries.filter((item) => item.id !== entry.id), entry].filter((item) => Date.parse(item.createdAt) >= cutoff).slice(-200)
    writeFile(path, ReviewKnowledgeFileSchema, { version: 1, entries })
    return entry
  })
  return { path, load, approvedRules, saveApprovedRule }
}

function pathMatches(rulePath: string | undefined, requestedPaths: readonly string[] | undefined): boolean {
  if (!rulePath || !requestedPaths?.length) return true
  return requestedPaths.some((requested) => requested === rulePath || requested.startsWith(`${rulePath}/`) || rulePath.startsWith(`${requested}/`))
}

function matchesKnowledge(entry: ReviewKnowledge, scope: ReviewKnowledgeScope): boolean {
  const repositoryMatches = scope.repository ? !entry.repository || entry.repository === scope.repository : !entry.repository
  const languageMatches = scope.languages?.length ? !entry.language || scope.languages.some((language) => language.toLowerCase() === entry.language?.toLowerCase()) : true
  const categoryMatches = scope.categories?.length ? !entry.category || scope.categories.includes(entry.category) : true
  return repositoryMatches && pathMatches(entry.path, scope.paths) && languageMatches && categoryMatches
}

function selectKnowledge(entries: readonly ReviewKnowledge[], input?: ReviewKnowledgeScopeInput): ReviewKnowledge[] {
  if (!input) return [...entries].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(-20)
  const scope = ReviewKnowledgeScopeSchema.parse(input)
  const characterBudget = scope.maxTokens * 4
  let characters = 0
  return [...entries]
    .filter((entry) => matchesKnowledge(entry, scope))
    .sort((left, right) => {
      const specificity = (entry: ReviewKnowledge) => Number(Boolean(entry.repository)) + Number(Boolean(entry.path)) + Number(Boolean(entry.language)) + Number(Boolean(entry.category))
      return specificity(right) - specificity(left) || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
    })
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.rule === entry.rule) === index)
    .filter((entry) => {
      if (characters + entry.rule.length > characterBudget) return false
      characters += entry.rule.length
      return true
    })
    .slice(0, scope.maxRules)
}

export function createApprovedReviewRetriever(store: ReviewKnowledgeStore, input: ReviewKnowledgeScopeInput = {}): Retriever {
  const scope = ReviewKnowledgeScopeSchema.parse(input)
  return {
    retrieve: async (): Promise<RetrievedDocument[]> => selectKnowledge(await store.load(), scope).map((entry, index) => ({
      id: entry.id,
      content: entry.rule,
      source: 'approved-review-knowledge',
      score: 1 - index / Math.max(scope.maxRules, 1),
      metadata: { repository: entry.repository, path: entry.path, language: entry.language, category: entry.category },
    })),
  }
}

export function createReviewStores(root: string): {
  layout: ReviewStoreLayout
  feedback: ReviewFeedbackStore
  knowledge: ReviewKnowledgeStore
} {
  const layout = createReviewStoreLayout(root)
  return {
    layout,
    feedback: createReviewFeedbackStore(layout.feedbackPath),
    knowledge: createReviewKnowledgeStore(layout.knowledgePath),
  }
}
