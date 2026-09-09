import assert from 'node:assert/strict'
import test from 'node:test'
import { createCampaignEngineState, replayCampaign, reviewIdentityFingerprint, transitionCampaign } from '../dist/src/index.js'

const fp = (character) => character.repeat(64)
const budget = { maxTokens: 10_000, maxCalls: 10, deadlineMs: 60_000 }
const campaign = {
  version: 1,
  campaignId: 'campaign-140',
  state: 'PLANNED',
  outcome: null,
  pullRequestRunIds: [],
  budgets: { campaign: budget, pullRequest: budget, contextPack: budget, analysis: budget, verification: budget },
  createdAt: '2026-09-09T00:00:00.000Z',
}
const identity = {
  version: 1,
  repository: 'AgentsKit-io/code-review',
  pullNumber: 140,
  headSha: fp('a').slice(0, 40),
  baseSha: fp('b').slice(0, 40),
  policyFingerprint: fp('c'),
  promptFingerprint: fp('d'),
  configurationFingerprint: fp('e'),
  model: { provider: 'fixture', name: 'offline' },
  packageVersion: '0.10.0',
}
const run = { version: 1, runId: 'run-140', campaignId: campaign.campaignId, state: 'DISCOVERED', outcome: null, identity, budget }
const unit = { version: 1, unitId: 'analysis-1', runId: run.runId, kind: 'ANALYSIS', state: 'PENDING', identityFingerprint: reviewIdentityFingerprint(identity), attempt: 0, budget }
const at = '2026-09-09T00:00:00.000Z'
const event = (sequence, payload) => ({ version: 1, eventId: `event-${sequence}`, campaignId: campaign.campaignId, sequence, occurredAt: at, payload })
const cleanEvents = [
  event(0, { type: 'CAMPAIGN_STARTED' }),
  event(1, { type: 'PULL_REQUEST_REGISTERED', run }),
  event(2, { type: 'PULL_REQUEST_ELIGIBLE', runId: run.runId }),
  event(3, { type: 'PREFLIGHT_PASSED', runId: run.runId }),
  event(4, { type: 'REVIEW_PLANNED', runId: run.runId }),
  event(5, { type: 'REVIEW_STARTED', runId: run.runId }),
  event(6, { type: 'REVIEW_UNIT_PLANNED', unit }),
  event(7, { type: 'REVIEW_UNIT_STARTED', unitId: unit.unitId }),
  event(8, { type: 'REVIEW_UNIT_COMPLETED', unitId: unit.unitId, evidenceFingerprint: fp('f') }),
  event(9, { type: 'PULL_REQUEST_TERMINATED', runId: run.runId, outcome: 'APPROVED' }),
  event(10, { type: 'CAMPAIGN_TERMINATED', outcome: 'COMPLETE' }),
]

test('a complete offline review reaches its terminal outcome through events only', () => {
  const initial = createCampaignEngineState(campaign)
  const before = JSON.stringify(initial)
  const final = cleanEvents.reduce(transitionCampaign, initial)
  assert.equal(final.campaign.outcome, 'COMPLETE')
  assert.equal(final.pullRequests[run.runId].outcome, 'APPROVED')
  assert.equal(final.reviewUnits[unit.unitId].state, 'COMPLETED')
  assert.equal(final.unitEvidence[unit.unitId], fp('f'))
  assert.equal(final.lastSequence, 10)
  assert.equal(JSON.stringify(initial), before)
  assert.equal(Object.isFrozen(final), true)
})

test('replay produces the identical final state', () => {
  const direct = cleanEvents.reduce(transitionCampaign, createCampaignEngineState(campaign))
  assert.deepEqual(replayCampaign(campaign, cleanEvents), direct)
})

test('invalid and post-terminal transitions fail closed', () => {
  const initial = createCampaignEngineState(campaign)
  assert.throws(() => transitionCampaign(initial, event(1, { type: 'CAMPAIGN_STARTED' })), /sequence 0/)
  assert.throws(() => transitionCampaign(initial, { ...event(0, { type: 'CAMPAIGN_STARTED' }), campaignId: 'other' }), /another campaign/)
  const started = transitionCampaign(initial, cleanEvents[0])
  assert.throws(() => transitionCampaign(started, event(1, { type: 'PULL_REQUEST_ELIGIBLE', runId: run.runId })), /missing/)
  const registered = transitionCampaign(started, cleanEvents[1])
  assert.throws(() => transitionCampaign(registered, event(2, { type: 'CAMPAIGN_TERMINATED', outcome: 'COMPLETE' })), /pull request is active/)
  const running = cleanEvents.slice(0, 6).reduce(transitionCampaign, initial)
  assert.throws(() => transitionCampaign(running, event(6, { type: 'PULL_REQUEST_TERMINATED', runId: run.runId, outcome: 'APPROVED' })), /complete review units/)
  const final = replayCampaign(campaign, cleanEvents)
  assert.throws(() => transitionCampaign(final, event(11, { type: 'CAMPAIGN_STARTED' })), /terminal campaign/)
})

test('failure, skip, and cancellation paths are deterministic', () => {
  const throughUnit = cleanEvents.slice(0, 8).reduce(transitionCampaign, createCampaignEngineState(campaign))
  const failed = transitionCampaign(throughUnit, event(8, { type: 'REVIEW_UNIT_FAILED', unitId: unit.unitId, failure: { disposition: 'TERMINAL', code: 'INVALID_OUTPUT', operation: 'analyze', message: 'invalid output' } }))
  assert.equal(failed.reviewUnits[unit.unitId].state, 'FAILED')
  assert.equal(failed.unitFailures[unit.unitId].code, 'INVALID_OUTPUT')

  const registered = cleanEvents.slice(0, 2).reduce(transitionCampaign, createCampaignEngineState(campaign))
  const skipped = transitionCampaign(registered, event(2, { type: 'PULL_REQUEST_TERMINATED', runId: run.runId, outcome: 'SKIPPED' }))
  assert.equal(skipped.pullRequests[run.runId].outcome, 'SKIPPED')

  const cancelled = transitionCampaign(registered, event(2, { type: 'CANCELLATION_REQUESTED', reason: 'operator request' }))
  assert.equal(cancelled.campaign.outcome, 'CANCELLED')
  assert.equal(cancelled.pullRequests[run.runId].outcome, 'CANCELLED')

  const cancelledWithUnit = transitionCampaign(throughUnit, event(8, { type: 'CANCELLATION_REQUESTED', reason: 'operator request' }))
  assert.equal(cancelledWithUnit.reviewUnits[unit.unitId].state, 'CANCELLED')
})
