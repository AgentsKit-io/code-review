import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChangeRequestDiffSchema, ChangeRequestMetadataSchema, ChangeRequestQuerySchema, ChangeRequestRefSchema,
  ScmCapabilitiesSchema, ScmMergeReadinessSchema, ScmMergeReceiptSchema, ScmMergeRequestSchema,
  ScmPublicationReceiptSchema, ScmReviewPublicationSchema, ScmReviewStateSchema,
  UnsupportedScmCapabilityError, requireScmCapability,
} from '../dist/src/scm-contract.js'

const ref = ChangeRequestRefSchema.parse({ repository: 'org/repo', id: '42' })
const capabilities = ScmCapabilitiesSchema.parse(Object.fromEntries([
  'discovery', 'metadata', 'diff', 'file-content', 'review-state', 'publish-review', 'merge-readiness', 'merge',
].map((capability) => [capability, true])))

class FakeScmAdapter {
  id = 'fake'
  capabilities = capabilities
  merged = false
  published = []

  async discover(query) {
    requireScmCapability(this, 'discovery')
    ChangeRequestQuerySchema.parse(query)
    return [ref]
  }
  async metadata(input) {
    requireScmCapability(this, 'metadata')
    return ChangeRequestMetadataSchema.parse({ ref: input, title: 'Safe change', state: 'open', author: 'teammate', sourceRevision: 'abcdef1', targetRevision: '1234567', sourceBranch: 'feature', targetBranch: 'main', isDraft: false, isFork: false, labels: ['team'], updatedAt: '2026-09-09T00:00:00.000Z' })
  }
  async diff(_input, baselineRevision) {
    requireScmCapability(this, 'diff')
    return ChangeRequestDiffSchema.parse({ baseRevision: baselineRevision ?? '1234567', headRevision: 'abcdef1', complete: true, files: [{ path: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@', content: 'export const a = 2', truncated: false }] })
  }
  async fileContent() {
    requireScmCapability(this, 'file-content')
    return { content: 'export const a = 2', truncated: false }
  }
  async reviewState(_input, fingerprint) {
    requireScmCapability(this, 'review-state')
    return ScmReviewStateSchema.parse({ headRevision: 'abcdef1', fingerprint, alreadyPublished: false, scope: 'full', baselineRevision: null })
  }
  async publishReview(_input, review) {
    requireScmCapability(this, 'publish-review')
    this.published.push(ScmReviewPublicationSchema.parse(review))
    return ScmPublicationReceiptSchema.parse({ id: 'review-1', url: 'https://scm.test/review-1' })
  }
  async mergeReadiness() {
    requireScmCapability(this, 'merge-readiness')
    return ScmMergeReadinessSchema.parse({ headRevision: 'abcdef1', ready: true, blockers: [] })
  }
  async merge(_input, request) {
    requireScmCapability(this, 'merge')
    ScmMergeRequestSchema.parse(request)
    this.merged = true
    return ScmMergeReceiptSchema.parse({ revision: 'fedcba9', mergedAt: '2026-09-09T00:01:00.000Z' })
  }
}

test('a deterministic fake SCM adapter exercises a complete change-request lifecycle', async () => {
  const scm = new FakeScmAdapter()
  const [found] = await scm.discover({ repository: 'org/repo', state: 'open', authors: ['teammate'], excludeAuthors: ['dependabot'], labels: ['team'] })
  const metadata = await scm.metadata(found)
  const diff = await scm.diff(found)
  const content = await scm.fileContent(found, diff.files[0].path, metadata.sourceRevision, 1_024)
  const state = await scm.reviewState(found, 'policy-v1')
  const publication = await scm.publishReview(found, { channel: 'review', headRevision: metadata.sourceRevision, fingerprint: state.fingerprint, verdict: 'APPROVE', summary: 'Complete and clean.', annotations: [{ path: diff.files[0].path, line: 1, body: 'Verified.' }] })
  const readiness = await scm.mergeReadiness(found)
  const merged = await scm.merge(found, { expectedHeadRevision: readiness.headRevision, method: 'squash' })

  assert.equal(diff.complete, true)
  assert.match(content.content, /export const a/)
  assert.equal(publication.id, 'review-1')
  assert.equal(readiness.ready, true)
  assert.equal(merged.revision, 'fedcba9')
  assert.equal(scm.published.length, 1)
  assert.equal(scm.merged, true)
})

test('unsupported SCM capabilities fail explicitly', () => {
  const adapter = { id: 'future-gitlab', capabilities: { ...capabilities, merge: false } }
  assert.throws(() => requireScmCapability(adapter, 'merge'), UnsupportedScmCapabilityError)
})

test('merge readiness rejects contradictory state', () => {
  assert.throws(() => ScmMergeReadinessSchema.parse({ headRevision: 'abcdef1', ready: true, blockers: ['checks pending'] }), /ready merge requests cannot have blockers/)
})
