import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  ReviewKnowledgeSchema,
  ReviewStoreLayoutSchema,
  createApprovedReviewRetriever,
  createReviewFeedbackStore,
  createReviewKnowledgeStore,
  createReviewStoreLayout,
} from '../dist/src/review-stores.js'

const run = async (fn) => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-review-stores-'))
  try { return await fn(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('store layout keeps state, cache, feedback, and knowledge lifecycles separate', () => {
  const layout = createReviewStoreLayout('/tmp/agentskit-review-stores')
  assert.equal(ReviewStoreLayoutSchema.parse(layout).version, 1)
  assert.equal(new Set([layout.operationalStatePath, layout.cachePath, layout.feedbackPath, layout.knowledgePath]).size, 4)
})

test('knowledge accepts only approved bounded rules and rejects secrets or source fields', async () => run(async (directory) => {
  const store = createReviewKnowledgeStore(join(directory, 'knowledge.json'))
  const entry = await store.saveApprovedRule({ rule: 'Use the audited boundary for external writes.', repository: 'AgentsKit-io/code-review' })
  assert.deepEqual(await store.approvedRules(), [entry.rule])
  assert.throws(() => ReviewKnowledgeSchema.parse({ ...entry, source: 'const secret = true' }), /Unrecognized key/)
  await assert.rejects(store.saveApprovedRule({ rule: 'Use npm_abcdefghijklmnop as a token.' }), /credential or private key/)
}))

test('retrieval is repository, path, language, category, and token bounded', async () => run(async (directory) => {
  const store = createReviewKnowledgeStore(join(directory, 'knowledge.json'))
  await store.saveApprovedRule({ rule: 'Global.', createdAt: '2026-01-01T00:00:00.000Z' })
  await store.saveApprovedRule({ rule: 'Wrong repository rule.', repository: 'other/repo', path: 'src/auth.ts', language: 'ts', category: 'security', createdAt: '2026-01-02T00:00:00.000Z' })
  await store.saveApprovedRule({ rule: 'Wrong path rule.', repository: 'org/repo', path: 'src/billing.ts', language: 'ts', category: 'security', createdAt: '2026-01-03T00:00:00.000Z' })
  const matching = await store.saveApprovedRule({ rule: 'Use the authorization guard.', repository: 'org/repo', path: 'src/auth', language: 'ts', category: 'security', createdAt: '2026-01-04T00:00:00.000Z' })
  const scope = { repository: 'org/repo', paths: ['src/auth/login.ts'], languages: ['TS'], categories: ['security'], maxRules: 5, maxTokens: 10 }
  assert.deepEqual(await store.approvedRules(scope), ['Use the authorization guard.', 'Global.'])
  const documents = await createApprovedReviewRetriever(store, scope).retrieve({ query: 'authorization', messages: [] })
  assert.deepEqual(documents.map((document) => document.id), [matching.id, (await store.load()).find((entry) => entry.rule === 'Global.')?.id])
  assert.equal(documents[0].metadata?.repository, 'org/repo')
  assert.deepEqual(await store.approvedRules({ paths: ['src/auth/login.ts'], maxTokens: 10 }), ['Global.'])
}))

test('malformed feedback and knowledge files fail closed', async () => run(async (directory) => {
  const knowledgePath = join(directory, 'knowledge.json')
  const feedbackPath = join(directory, 'feedback.json')
  writeFileSync(knowledgePath, JSON.stringify({ version: 99, entries: [] }))
  writeFileSync(feedbackPath, JSON.stringify({ version: 99, entries: [] }))
  await assert.rejects(createReviewKnowledgeStore(knowledgePath).load(), /malformed/)
  await assert.rejects(createReviewFeedbackStore(feedbackPath).load(), /malformed/)
}))

test('concurrent feedback appends across store instances remain valid and lossless', async () => run(async (directory) => {
  const path = join(directory, 'feedback.json')
  const stores = [createReviewFeedbackStore(path), createReviewFeedbackStore(path)]
  await Promise.all(Array.from({ length: 40 }, (_, index) => stores[index % 2].append({
    runId: `run-${index}`,
    repository: 'AgentsKit-io/code-review',
    pullNumber: 154,
    headSha: `sha-${index}`,
    finding: { file: `src/${index}.ts`, line: 1, title: `Finding ${index}`, status: 'pending' },
  })))
  const entries = await stores[0].load()
  assert.equal(entries.length, 40)
  assert.equal(new Set(entries.map((entry) => entry.runId)).size, 40)
}))
