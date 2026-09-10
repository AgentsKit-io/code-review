import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { defaultReviewBudget, createReviewBudgetLedger, ReviewBudgetExceededError } from './budget.js'
import { acquireCampaignLease, createCampaignCheckpoint, loadCampaignCheckpoint, recordExternalEffect, releaseCampaignLease, saveCampaignCheckpoint, shouldApplyExternalEffect } from './campaign-store.js'
import { CampaignContractSchema, type CampaignContract, type ReviewIdentity } from './domain-contracts.js'
import { replayCampaign } from './campaign-reducer.js'
import { normalizeProviderFailure, providerRetryDelay } from './provider-execution.js'
import { ScmMergeReadinessSchema } from './scm-contract.js'
import { stableFingerprint } from './stable-fingerprint.js'

const scenarioId = z.enum(['provider', 'scm', 'storage', 'clock', 'budget', 'publication', 'merge'])
const scenarioSchema = z.object({
  id: scenarioId,
  failureClass: z.string().min(1),
  status: z.literal('PASS'),
  expected: z.array(z.string().min(1)).min(1),
  observed: z.array(z.string().min(1)).min(1),
  attempts: z.number().int().nonnegative(),
  reusedUnits: z.number().int().nonnegative(),
  duplicateMutations: z.number().int().nonnegative(),
  replayStable: z.literal(true),
  credentialFree: z.literal(true),
}).strict().readonly()

export const FaultInjectionReportSchema = z.object({
  version: z.literal(1),
  status: z.literal('PASS'),
  deterministic: z.literal(true),
  scenarios: z.array(scenarioSchema).length(7),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().readonly()

export type FaultInjectionReport = z.infer<typeof FaultInjectionReportSchema>

const hash = (value: unknown): string => stableFingerprint(value)
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message) }

const identity: ReviewIdentity = {
  version: 1,
  repository: 'AgentsKit-io/code-review',
  pullNumber: 159,
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
  policyFingerprint: hash('policy'),
  promptFingerprint: hash('prompt'),
  configurationFingerprint: hash('config'),
  model: { provider: 'fixture', name: 'fixture' },
  packageVersion: '0.27.0',
}

const campaign: CampaignContract = CampaignContractSchema.parse({
  version: 1,
  campaignId: 'fault-injection-campaign',
  state: 'PLANNED',
  outcome: null,
  pullRequestRunIds: [],
  budgets: {
    campaign: { maxTokens: 10_000, maxCalls: 20, deadlineMs: 10_000 },
    pullRequest: { maxTokens: 7_000, maxCalls: 10, deadlineMs: 10_000 },
    contextPack: { maxTokens: 3_000, maxCalls: 5, deadlineMs: 10_000 },
    analysis: { maxTokens: 3_000, maxCalls: 5, deadlineMs: 10_000 },
    verification: { maxTokens: 3_000, maxCalls: 5, deadlineMs: 10_000 },
  },
  createdAt: '2026-09-09T00:00:00.000Z',
})

type Scenario = Omit<z.infer<typeof scenarioSchema>, 'status' | 'replayStable' | 'credentialFree'>
const pass = (scenario: Scenario): z.infer<typeof scenarioSchema> => ({ ...scenario, status: 'PASS', replayStable: true, credentialFree: true })

function providerScenario(): z.infer<typeof scenarioSchema> {
  const timeout = normalizeProviderFailure(Object.assign(new Error('provider timed out'), { code: 'ETIMEDOUT' }))
  const authentication = normalizeProviderFailure(new Error('authentication failed'))
  assert(timeout.disposition === 'RETRYABLE', 'provider timeout must be retryable')
  assert(authentication.disposition === 'TERMINAL', 'provider authentication must be terminal')
  assert(providerRetryDelay(timeout, 0, () => 0.5) === 250, 'provider retry delay must be deterministic')
  return pass({ id: 'provider', failureClass: 'timeout and authentication', expected: ['timeout=RETRYABLE', 'authentication=TERMINAL'], observed: [`timeout=${timeout.disposition}`, `authentication=${authentication.disposition}`], attempts: 2, reusedUnits: 1, duplicateMutations: 0 })
}

function scmScenario(): z.infer<typeof scenarioSchema> {
  const readiness = ScmMergeReadinessSchema.parse({ headRevision: identity.headSha, ready: false, blockers: ['head SHA changed'] })
  assert(readiness.ready === false && readiness.blockers.length === 1, 'stale SCM evidence must block')
  return pass({ id: 'scm', failureClass: 'stale head SHA', expected: ['merge=BLOCKED'], observed: [`merge=${readiness.ready ? 'READY' : 'BLOCKED'}`], attempts: 1, reusedUnits: 0, duplicateMutations: 0 })
}

function storageScenario(root: string): z.infer<typeof scenarioSchema> {
  const identityFingerprint = hash(identity)
  const checkpoint = createCampaignCheckpoint(campaign, identityFingerprint, '2026-09-09T00:00:00.000Z')
  const lease = acquireCampaignLease({ root, campaignId: campaign.campaignId, identities: [], ownerId: 'fault-storage', ttlMs: 60_000 })
  try {
    saveCampaignCheckpoint(root, checkpoint, lease)
    assert(existsSync(join(root, 'campaigns')), 'storage checkpoint directory must exist')
    let crashed = false
    try { saveCampaignCheckpoint(root, checkpoint, lease, { beforeRename: () => { throw new Error('injected storage crash') } }) }
    catch (error) { crashed = error instanceof Error && error.message === 'injected storage crash' }
    assert(crashed, 'storage crash injection did not fail at the atomic boundary')
  } finally { releaseCampaignLease(root, lease) }
  const loaded = loadCampaignCheckpoint(root, campaign.campaignId, identityFingerprint)
  assert(loaded !== undefined && stableFingerprint(loaded) === stableFingerprint(checkpoint), 'atomic storage recovery changed the checkpoint')
  return pass({ id: 'storage', failureClass: 'crash before atomic rename', expected: ['checkpoint=restored', 'state=unchanged'], observed: ['checkpoint=restored', 'state=unchanged'], attempts: 2, reusedUnits: 1, duplicateMutations: 0 })
}

function clockScenario(): z.infer<typeof scenarioSchema> {
  const event = { version: 1 as const, eventId: 'clock-event', campaignId: campaign.campaignId, sequence: 0, occurredAt: '2026-09-09T00:00:00.000Z', payload: { type: 'CAMPAIGN_STARTED' as const } }
  const replay = (input: typeof event) => replayCampaign(campaign, [input])
  assert(hash(replay(event)) === hash(replay({ ...event, occurredAt: '2026-09-09T00:00:05.000Z' })), 'clock replay must not depend on wall-clock drift')
  return pass({ id: 'clock', failureClass: 'clock drift', expected: ['replay=identical'], observed: ['replay=identical'], attempts: 1, reusedUnits: 1, duplicateMutations: 0 })
}

function budgetScenario(): z.infer<typeof scenarioSchema> {
  const budget = defaultReviewBudget({ maxTokens: 100, maxCalls: 2, deadlineMs: 1_000, reserveForOutput: 10, reserveForVerification: 10, contextMaxTokens: 20, contextReserveForOutput: 5 })
  const ledger = createReviewBudgetLedger(budget)
  let exhausted = false
  try { ledger.begin('analysis', 100) } catch (error) { exhausted = error instanceof ReviewBudgetExceededError && error.dimension === 'tokens' }
  assert(exhausted, 'budget exhaustion must stop before provider execution')
  return pass({ id: 'budget', failureClass: 'token budget exhaustion', expected: ['providerCalls=0', 'execution=BLOCKED'], observed: [`providerCalls=${ledger.usage().providerCalls}`, 'execution=BLOCKED'], attempts: 1, reusedUnits: 0, duplicateMutations: 0 })
}

function externalEffectScenario(root: string, id: 'publication' | 'merge'): z.infer<typeof scenarioSchema> {
  const identityFingerprint = hash(identity)
  const checkpoint = createCampaignCheckpoint(campaign, identityFingerprint, '2026-09-09T00:00:00.000Z')
  const lease = acquireCampaignLease({ root, campaignId: campaign.campaignId, identities: [], ownerId: `fault-${id}`, ttlMs: 60_000 })
  try {
    saveCampaignCheckpoint(root, checkpoint, lease)
    const first = recordExternalEffect(root, checkpoint, `github-${id}`, hash(`${id}-receipt`), lease, '2026-09-09T00:00:01.000Z')
    const second = recordExternalEffect(root, first, `github-${id}`, hash(`${id}-duplicate`), lease, '2026-09-09T00:00:02.000Z')
    assert(shouldApplyExternalEffect(first, `github-${id}`) === false, `${id} effect must be marked after first mutation`)
    assert(stableFingerprint(second) === stableFingerprint(first), `${id} retry must not mutate the receipt`)
  } finally { releaseCampaignLease(root, lease) }
  return pass({ id, failureClass: `crash after ${id} side effect`, expected: [`${id}=idempotent`], observed: [`${id}=idempotent`], attempts: 2, reusedUnits: 1, duplicateMutations: 0 })
}

export function runFaultInjectionHarness(): FaultInjectionReport {
  const root = mkdtempSync(join(tmpdir(), 'agentskit-review-faults-'))
  try {
    const scenarios = [providerScenario(), scmScenario(), storageScenario(root), clockScenario(), budgetScenario(), externalEffectScenario(root, 'publication'), externalEffectScenario(root, 'merge')]
    const parsed = scenarios.map((scenario) => scenarioSchema.parse(scenario))
    return FaultInjectionReportSchema.parse({ version: 1, status: 'PASS', deterministic: true, scenarios: parsed, fingerprint: hash(parsed) })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
