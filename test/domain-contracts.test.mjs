import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BudgetEnvelopeSchema,
  CampaignContractSchema,
  CampaignEventSchema,
  CampaignTerminalOutcomeSchema,
  DomainFailureSchema,
  PullRequestRunContractSchema,
  PullRequestTerminalOutcomeSchema,
  ReviewIdentitySchema,
  ReviewUnitContractSchema,
  reviewIdentityFingerprint,
} from '../dist/src/index.js'

const fingerprint = 'a'.repeat(64)
const budget = { maxTokens: 10_000, maxCalls: 10, deadlineMs: 60_000 }
const budgets = { campaign: budget, pullRequest: budget, contextPack: budget, analysis: budget, verification: budget }
const identity = {
  version: 1,
  repository: 'AgentsKit-io/code-review',
  pullNumber: 139,
  headSha: 'b'.repeat(40),
  baseSha: 'c'.repeat(40),
  policyFingerprint: fingerprint,
  promptFingerprint: 'd'.repeat(64),
  configurationFingerprint: 'e'.repeat(64),
  model: { provider: 'codex-cli', name: 'gpt-5' },
  packageVersion: '0.9.0',
}
const run = { version: 1, runId: 'run-139', campaignId: 'campaign-139', state: 'DISCOVERED', outcome: null, identity, budget }
const unit = { version: 1, unitId: 'unit-1', runId: run.runId, kind: 'ANALYSIS', state: 'PENDING', identityFingerprint: reviewIdentityFingerprint(identity), attempt: 0, budget }

test('terminal outcomes are versioned and exhaustive', () => {
  assert.deepEqual(CampaignTerminalOutcomeSchema.options, ['COMPLETE', 'PARTIAL', 'BLOCKED', 'CANCELLED'])
  assert.deepEqual(PullRequestTerminalOutcomeSchema.options, ['SKIPPED', 'BLOCKED', 'APPROVED', 'CHANGES_REQUESTED', 'MERGE_BLOCKED', 'MERGED', 'CANCELLED'])
  assert.throws(() => CampaignContractSchema.parse({ version: 1, campaignId: 'campaign-139', state: 'TERMINAL', outcome: null, pullRequestRunIds: [], budgets, createdAt: new Date().toISOString() }), /only terminal campaigns/)
  assert.throws(() => PullRequestRunContractSchema.parse({ ...run, outcome: 'APPROVED' }), /only terminal pull-request runs/)
})

test('review identities are immutable, complete, and stable', () => {
  const parsed = ReviewIdentitySchema.parse(identity)
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(reviewIdentityFingerprint(parsed), reviewIdentityFingerprint({ ...identity, model: { name: 'gpt-5', provider: 'codex-cli' } }))
  const { promptFingerprint: _, ...incomplete } = identity
  assert.equal(ReviewIdentitySchema.safeParse(incomplete).success, false)
})

test('failure dispositions require their specific recovery metadata', () => {
  const base = { code: 'PROVIDER_TIMEOUT', operation: 'analyze', message: 'provider timed out' }
  for (const failure of [
    { ...base, disposition: 'TERMINAL' },
    { ...base, disposition: 'RETRYABLE', retryAfterMs: 100 },
    { ...base, disposition: 'REPLANNABLE', replanReason: 'split context pack' },
    { ...base, disposition: 'CANCELLED' },
  ]) assert.equal(DomainFailureSchema.safeParse(failure).success, true)
  assert.equal(DomainFailureSchema.safeParse({ ...base, disposition: 'RETRYABLE' }).success, false)
  assert.equal(DomainFailureSchema.safeParse({ ...base, disposition: 'REPLANNABLE' }).success, false)
})

test('domain contracts JSON-roundtrip without external access', () => {
  const values = [
    BudgetEnvelopeSchema.parse(budgets),
    PullRequestRunContractSchema.parse(run),
    ReviewUnitContractSchema.parse(unit),
    CampaignEventSchema.parse({ version: 1, eventId: 'event-1', campaignId: run.campaignId, sequence: 0, occurredAt: new Date().toISOString(), payload: { type: 'REVIEW_UNIT_PLANNED', unit } }),
  ]
  for (const value of values) assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
})
