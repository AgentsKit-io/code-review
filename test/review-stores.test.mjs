import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  ReviewKnowledgeSchema,
  ReviewStoreLayoutSchema,
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
