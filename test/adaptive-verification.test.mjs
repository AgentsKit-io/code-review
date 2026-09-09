import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'
import { codexCli } from '../dist/src/codex-adapter.js'

const root = new URL('..', import.meta.url).pathname
const fixtureBin = join(root, 'test/fixtures/bin')
const source = `export function deleteAccount(store, token) {
  if (!token) throw new Error('unauthorized')
  return store.remove()
}
export function canDeleteAccount(token) {
  return Boolean(token)
}
`

async function run(extraEnv = {}, options = {}) {
  const previous = { path: process.env.PATH }
  const names = ['CODEX_FIXTURE_QUALITY_CORPUS', 'CODEX_FIXTURE_VERIFICATION_FAIL', 'CODEX_FIXTURE_VERIFICATION_MALFORMED', 'CODEX_FIXTURE_VERIFICATION_DISAGREE']
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
  for (const name of names) {
    if (extraEnv[name] === undefined) delete process.env[name]
    else process.env[name] = extraEnv[name]
  }
  process.env.CODEX_FIXTURE_QUALITY_CORPUS = '1'
  try {
    const agent = createCodeReviewAgent({
      adapter: codexCli(),
      source: { kind: 'stdin', content: source, filename: 'snippet.ts' },
      auditVotes: 3,
      consolidate: false,
      reporters: [],
      verification: options.verification,
    })
    return await agent.run()
  } finally {
    process.env.PATH = previous.path
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  }
}

test('adaptive verification batches candidates and preserves detections', async () => {
  const review = await run({}, { verification: { maxBatchFindings: 8 } })
  assert.equal(review.incomplete, false)
  assert.equal(review.findings.length, 2)
  assert.equal(review.evidence.verificationCandidates, 2)
  assert.equal(review.evidence.verificationRequests, 2)
  assert.equal(review.evidence.verificationFailedRequests, 0)
  assert.equal(review.evidence.verificationUnverifiedFindings, 0)
  assert.ok(review.evidence.verificationRequests < review.evidence.verificationCandidates * 3)
})

test('third vote is used only for configured disagreement', async () => {
  const review = await run({ CODEX_FIXTURE_VERIFICATION_DISAGREE: '1' })
  assert.equal(review.incomplete, false)
  assert.equal(review.evidence.verificationRequests, 3)
  assert.equal(review.evidence.verificationVotes, 6)
  assert.equal(review.evidence.verificationUnverifiedFindings, 0)
})

test('malformed or failed verification is incomplete and cannot approve', async () => {
  const malformed = await run({ CODEX_FIXTURE_VERIFICATION_MALFORMED: '1' })
  assert.equal(malformed.incomplete, true)
  assert.equal(malformed.verdict, 'COMMENT')
  assert.equal(malformed.findings.length, 0)
  assert.equal(malformed.evidence.verificationUnverifiedFindings, 2)

  const failed = await run({ CODEX_FIXTURE_VERIFICATION_FAIL: '1' })
  assert.equal(failed.incomplete, true)
  assert.equal(failed.verdict, 'COMMENT')
  assert.equal(failed.findings.length, 0)
  assert.equal(failed.evidence.verificationFailedRequests, 1)
})
