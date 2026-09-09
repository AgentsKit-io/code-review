import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  CampaignCheckpointSchema,
  acquireCampaignLease,
  appendCampaignEvent,
  createCampaignCheckpoint,
  loadCampaignCheckpoint,
  pendingReviewUnitIds,
  recordExternalEffect,
  releaseCampaignLease,
  saveCampaignCheckpoint,
  shouldApplyExternalEffect,
  transitionCampaign,
} from '../dist/src/index.js'
import { stableFingerprint } from '../dist/src/stable-fingerprint.js'

const hash = (value) => value.repeat(64)
const budget = { maxTokens: 100, maxCalls: 2, deadlineMs: 1_000 }
const identity = {
  version: 1,
  repository: 'AgentsKit-io/code-review',
  pullNumber: 141,
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
  policyFingerprint: hash('1'),
  promptFingerprint: hash('2'),
  configurationFingerprint: hash('3'),
  model: { provider: 'fixture', name: 'fixture' },
  packageVersion: '0.11.0',
}
const campaign = (campaignId = 'campaign-141') => ({
  version: 1,
  campaignId,
  state: 'PLANNED',
  outcome: null,
  pullRequestRunIds: [],
  budgets: { campaign: budget, pullRequest: budget, contextPack: budget, analysis: budget, verification: budget },
  createdAt: '2026-09-08T00:00:00.000Z',
})
const run = { version: 1, runId: 'run-141', campaignId: 'campaign-141', state: 'DISCOVERED', outcome: null, identity, budget }
const unit = { version: 1, unitId: 'unit-141', runId: 'run-141', kind: 'ANALYSIS', state: 'PENDING', identityFingerprint: hash('4'), attempt: 0, budget }
const payloads = [
  { type: 'CAMPAIGN_STARTED' },
  { type: 'PULL_REQUEST_REGISTERED', run },
  { type: 'PULL_REQUEST_ELIGIBLE', runId: run.runId },
  { type: 'PREFLIGHT_PASSED', runId: run.runId },
  { type: 'REVIEW_PLANNED', runId: run.runId },
  { type: 'REVIEW_STARTED', runId: run.runId },
  { type: 'REVIEW_UNIT_PLANNED', unit },
  { type: 'REVIEW_UNIT_STARTED', unitId: unit.unitId },
  { type: 'REVIEW_UNIT_COMPLETED', unitId: unit.unitId, evidenceFingerprint: hash('5') },
  { type: 'PULL_REQUEST_TERMINATED', runId: run.runId, outcome: 'APPROVED' },
  { type: 'CAMPAIGN_TERMINATED', outcome: 'COMPLETE' },
]
const event = (sequence) => ({ version: 1, eventId: `event-${sequence}`, campaignId: 'campaign-141', sequence, occurredAt: `2026-09-08T00:00:${String(sequence).padStart(2, '0')}.000Z`, payload: payloads[sequence] })

test('atomic checkpoints survive a crash before every lifecycle commit and resume by replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'campaign-store-'))
  const lease = acquireCampaignLease({ root, campaignId: 'campaign-141', identities: [identity], ownerId: 'worker-a', ttlMs: 60_000 })
  try {
    let checkpoint = createCampaignCheckpoint(campaign(), hash('6'))
    saveCampaignCheckpoint(root, checkpoint, lease)
    for (let sequence = 0; sequence < payloads.length; sequence++) {
      const nextEvent = event(sequence)
      const candidate = CampaignCheckpointSchema.parse({
        ...checkpoint,
        events: [...checkpoint.events, nextEvent],
        state: transitionCampaign(checkpoint.state, nextEvent),
        updatedAt: '2026-09-08T01:00:00.000Z',
      })
      assert.throws(() => saveCampaignCheckpoint(root, candidate, lease, { beforeRename: () => { throw new Error('injected crash') } }), /injected crash/)
      assert.deepEqual(loadCampaignCheckpoint(root, 'campaign-141', hash('6')), checkpoint)
      checkpoint = appendCampaignEvent(root, checkpoint, nextEvent, lease)
      assert.deepEqual(loadCampaignCheckpoint(root, 'campaign-141', hash('6')), checkpoint)
    }
    assert.equal(checkpoint.state.campaign.outcome, 'COMPLETE')
  } finally {
    releaseCampaignLease(root, lease)
    rmSync(root, { recursive: true, force: true })
  }
})

test('leases exclude the same campaign or pull request and allow stale recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'campaign-lease-'))
  const first = acquireCampaignLease({ root, campaignId: 'campaign-141', identities: [identity], ownerId: 'worker-a', ttlMs: 60_000 })
  try {
    assert.throws(() => acquireCampaignLease({ root, campaignId: 'campaign-141', identities: [], ownerId: 'worker-b', ttlMs: 60_000 }), /already held/)
    assert.throws(() => acquireCampaignLease({ root, campaignId: 'another-campaign', identities: [identity], ownerId: 'worker-b', ttlMs: 60_000 }), /already held/)
    assert.throws(() => acquireCampaignLease({ root, campaignId: 'rollback-campaign', identities: [identity], ownerId: 'worker-b', ttlMs: 60_000 }), /already held/)
    const rollbackRecovered = acquireCampaignLease({ root, campaignId: 'rollback-campaign', identities: [], ownerId: 'worker-c', ttlMs: 60_000 })
    releaseCampaignLease(root, rollbackRecovered)
  } finally { releaseCampaignLease(root, first) }
  const stale = acquireCampaignLease({ root, campaignId: 'stale', identities: [], ownerId: 'dead-worker', ttlMs: 1, now: 0 })
  const replacement = acquireCampaignLease({ root, campaignId: 'stale', identities: [], ownerId: 'worker-c', ttlMs: 60_000 })
  assert.notEqual(replacement.token, stale.token)
  releaseCampaignLease(root, stale)
  assert.throws(() => acquireCampaignLease({ root, campaignId: 'stale', identities: [], ownerId: 'worker-d', ttlMs: 60_000 }), /already held/)
  releaseCampaignLease(root, replacement)
  rmSync(root, { recursive: true, force: true })
})

test('resume rejects changed identity and skips completed units and recorded effects', () => {
  const root = mkdtempSync(join(tmpdir(), 'campaign-resume-'))
  const lease = acquireCampaignLease({ root, campaignId: 'campaign-141', identities: [identity], ownerId: 'worker-a', ttlMs: 60_000 })
  try {
    let checkpoint = createCampaignCheckpoint(campaign(), hash('6'))
    saveCampaignCheckpoint(root, checkpoint, lease)
    for (let sequence = 0; sequence <= 8; sequence++) checkpoint = appendCampaignEvent(root, checkpoint, event(sequence), lease)
    assert.deepEqual(pendingReviewUnitIds(checkpoint), [])
    assert.equal(shouldApplyExternalEffect(checkpoint, 'github-review'), true)
    checkpoint = recordExternalEffect(root, checkpoint, 'github-review', hash('7'), lease)
    const unchanged = recordExternalEffect(root, checkpoint, 'github-review', hash('8'), lease)
    assert.deepEqual(unchanged, checkpoint)
    assert.equal(shouldApplyExternalEffect(checkpoint, 'github-review'), false)
    assert.throws(() => loadCampaignCheckpoint(root, 'campaign-141', hash('9')), /identity is stale/)
  } finally {
    releaseCampaignLease(root, lease)
    rmSync(root, { recursive: true, force: true })
  }
})

test('a checkpoint lease must cover every registered pull request', () => {
  const root = mkdtempSync(join(tmpdir(), 'campaign-coverage-'))
  const lease = acquireCampaignLease({ root, campaignId: 'campaign-141', identities: [], ownerId: 'worker-a', ttlMs: 60_000 })
  try {
    let checkpoint = createCampaignCheckpoint(campaign(), hash('6'))
    saveCampaignCheckpoint(root, checkpoint, lease)
    checkpoint = { ...checkpoint, events: [event(0)], state: transitionCampaign(checkpoint.state, event(0)) }
    saveCampaignCheckpoint(root, checkpoint, lease)
    const registration = event(1)
    const candidate = CampaignCheckpointSchema.parse({ ...checkpoint, events: [...checkpoint.events, registration], state: transitionCampaign(checkpoint.state, registration) })
    assert.throws(() => saveCampaignCheckpoint(root, candidate, lease), /all registered pull requests/)
  } finally {
    releaseCampaignLease(root, lease)
    rmSync(root, { recursive: true, force: true })
  }
})

test('an abandoned guard and incomplete lease directory are reclaimable', () => {
  const root = mkdtempSync(join(tmpdir(), 'campaign-stale-guard-'))
  const directory = join(root, 'leases', stableFingerprint('campaign:stale-guard'))
  const guard = join(directory, '.guard')
  mkdirSync(guard, { recursive: true })
  utimesSync(guard, 0, 0)
  const lease = acquireCampaignLease({ root, campaignId: 'stale-guard', identities: [], ownerId: 'worker', ttlMs: 60_000 })
  releaseCampaignLease(root, lease)
  rmSync(root, { recursive: true, force: true })
})
