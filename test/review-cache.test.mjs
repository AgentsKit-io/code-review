import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createReviewCache, reviewCacheKey } from '../dist/src/index.js'

const hash = (value) => value.repeat(64)
const identity = {
  sourceFingerprint: hash('a'),
  diffFingerprint: hash('b'),
  baseFingerprint: hash('c'),
  policyFingerprint: hash('d'),
  promptFingerprint: hash('e'),
  modelFingerprint: hash('f'),
  knowledgeFingerprint: hash('0'),
}
const write = {
  provenance: { repository: 'AgentsKit-io/code-review', pullNumber: 152, unitId: 'batch-0', sourceFiles: ['src/review.ts'], sourceRevision: 'head-sha', createdAt: '2026-09-09T00:00:00.000Z' },
  tokenUsage: { inputTokens: 20, outputTokens: 22, totalTokens: 42, providerCalls: 1 },
  validation: { status: 'passed', checkedAt: '2026-09-09T00:00:00.000Z', evidenceFingerprint: hash('1') },
  value: { review: 'approved' },
}

test('reuses a validated unit and preserves provenance and token savings', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-cache-'))
  try {
    const cache = createReviewCache(root)
    let providerCalls = 0
    const first = cache.get(identity)
    assert.deepEqual(first, { hit: false, reason: 'missing' })
    if (!first.hit) { providerCalls += 1; cache.set(identity, write) }
    const second = cache.get(identity)
    assert.equal(second.hit, true)
    if (second.hit) {
      assert.equal(second.record.tokenUsage.totalTokens, 42)
      assert.equal(second.record.provenance.unitId, 'batch-0')
      assert.deepEqual(second.record.value, { review: 'approved' })
    }
    assert.equal(providerCalls, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('every relevant identity change misses without reusing stale work', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-cache-'))
  try {
    const cache = createReviewCache(root)
    cache.set(identity, write)
    for (const field of Object.keys(identity)) {
      const changed = { ...identity, [field]: hash('z') }
      assert.equal(cache.get(changed).hit, false, field)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('corrupt, mismatched, and unvalidated entries fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-cache-'))
  try {
    const cache = createReviewCache(root)
    writeFileSync(cache.pathFor(identity), '{broken')
    assert.deepEqual(cache.get(identity), { hit: false, reason: 'corrupt' })
    cache.set(identity, { ...write, validation: { ...write.validation, status: 'failed' } })
    assert.deepEqual(cache.get(identity), { hit: false, reason: 'unvalidated' })
    const record = JSON.parse(readFileSync(cache.pathFor(identity), 'utf8'))
    record.key = hash('9')
    writeFileSync(cache.pathFor(identity), JSON.stringify(record))
    assert.deepEqual(cache.get(identity), { hit: false, reason: 'stale' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('atomic replacement keeps a valid record under concurrent writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review-cache-'))
  try {
    const cache = createReviewCache(root)
    await Promise.all(Array.from({ length: 8 }, (_, index) => Promise.resolve().then(() => cache.set(identity, { ...write, value: { index } }))))
    const result = cache.get(identity)
    assert.equal(result.hit, true)
    assert.equal(reviewCacheKey(identity).length, 64)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
