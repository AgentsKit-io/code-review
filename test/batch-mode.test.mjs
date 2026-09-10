import assert from 'node:assert/strict'
import test from 'node:test'
import { assertBatchManifestComplete, planReviewBatches, batchSourceRequested } from '../dist/src/batch-mode.js'

test('batch planning widens the PR source before partitioning', () => {
  assert.equal(batchSourceRequested(undefined, '10'), true)
  assert.equal(batchSourceRequested('0', '10'), true)
  assert.equal(batchSourceRequested(undefined, undefined), false)
})

test('batch planning splits oversized invocations and rejects unsplittable files', async () => {
  const measure = async (files) => ({ overBudget: files.includes('huge.ts') || files.length > 2 ? ['estimated analysis tokens exceed analysis capacity'] : [] })
  const result = await planReviewBatches(['d.ts', 'c.ts', 'b.ts', 'a.ts'], 5, measure)
  assert.deepEqual(result.batches, [{ index: 0, files: ['a.ts', 'b.ts'] }, { index: 1, files: ['c.ts', 'd.ts'] }])
  assert.deepEqual(result.overBudget, [])
  const blocked = await planReviewBatches(['huge.ts', 'small.ts'], 5, measure)
  assert.match(blocked.overBudget.join('; '), /huge.ts.*analysis capacity/)
  assert.equal(blocked.batches.length, 2)
})

test('batch manifests fail closed when any source file is unreviewed', () => {
  assert.doesNotThrow(() => assertBatchManifestComplete([]))
  assert.throws(() => assertBatchManifestComplete([{ file: 'large.bin' }]), /complete source coverage.*large\.bin/)
})

test('a file larger than one invocation is divided by context pack without losing coverage', async () => {
  const packs = ['pack-1', 'pack-2', 'pack-3', 'pack-4']
  const result = await planReviewBatches(['large.api.md'], 5, async (_files, selected = packs) => ({
    overBudget: selected.length > 2 ? ['token capacity exceeded'] : [],
    contextPacks: selected.map(id => ({ id })),
  }))
  assert.deepEqual(result.overBudget, [])
  assert.deepEqual(result.batches.map(batch => batch.packIds), [packs.slice(0, 2), packs.slice(2)])
})
