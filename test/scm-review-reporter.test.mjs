import assert from 'node:assert/strict'
import test from 'node:test'
import { scmReviewReporter } from '../dist/agents/code-review/reporters.js'

const publishedWith = async (review) => {
  const calls = []
  const adapter = { publishReview: async (_ref, input) => { calls.push(input); return {} } }
  await scmReviewReporter({ adapter, ref: { repository: 'org/repo', id: '7' }, channel: 'review', headRevision: 'abc123', fingerprint: 'fp-1' }).emit(review)
  return calls[0]
}

test('an incomplete review is published without the idempotency marker, so the next run reviews the head again', async () => {
  // Live (vivva #70, PR #236): an incomplete run posted with the marker; every retry at that head printed
  // "SKIPPED: already reviewed" and exited 0 without the --result file the harness asked for.
  const incomplete = await publishedWith({ verdict: 'COMMENT', summary: 'partial', findings: [], incomplete: true })
  assert.equal(incomplete.fingerprint, undefined)
  const complete = await publishedWith({ verdict: 'COMMENT', summary: 'done', findings: [], incomplete: false })
  assert.equal(complete.fingerprint, 'fp-1')
})
