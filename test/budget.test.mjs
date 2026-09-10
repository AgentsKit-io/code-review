import test from 'node:test'
import assert from 'node:assert/strict'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'
import {
  ReviewBudgetExceededError,
  compileReviewBudget,
  createReviewBudgetLedger,
  defaultReviewBudget,
  tightenReviewBudget,
} from '../dist/src/budget.js'

test('fatal model-call budget errors abort and drain active review calls', async () => {
  let started = 0
  let aborted = 0
  let settled = 0
  const adapter = { createSource() {
    let finish
    let cancelled = false
    return {
      async *stream() {
        started++
        if (!cancelled) await new Promise(resolve => { finish = resolve })
        settled++
      },
      abort() { cancelled = true; aborted++; finish?.() },
    }
  } }
  const hierarchy = defaultReviewBudget({ maxTokens: 500000, maxCalls: 100, deadlineMs: 2000,
    reserveForOutput: 2000, reserveForVerification: 2000, contextMaxTokens: 16000, contextReserveForOutput: 2000 })
  hierarchy.analysis.maxCalls = 2
  const agent = createCodeReviewAgent({ adapter, source: { kind: 'stdin', content: 'export const answer = 42\n' },
    batchLenses: false, profile: 'full', reporters: [], budget: { maxTokens: 500000, maxCalls: 100, concurrency: 8, deadlineMs: 2000, hierarchy } })
  await assert.rejects(agent.run(), /calls budget exceeded/)
  assert.ok(started > 0)
  assert.ok(aborted >= started)
  assert.equal(settled, started)
})

test('resource ceilings never loosen a configured child scope', () => {
  const tightened = tightenReviewBudget(budget, { maxTokens: 8000, maxCalls: 4 })
  assert.equal(tightened.campaign.maxCalls, 4)
  assert.equal(tightened.pullRequest.maxCalls, 3)
  assert.equal(tightened.contextPack.maxTokens, budget.contextPack.maxTokens)
  assert.ok(tightened.analysis.maxTokens <= budget.analysis.maxTokens)
})

test('known usage enforces tokens despite unavailable optional fields without double counting subsets', () => {
  const ledger = createReviewBudgetLedger(budget)
  ledger.begin('analysis', 100).finish({ inputTokens: 6000, outputTokens: 500, cachedInputTokens: 5000, reasoningOutputTokens: 400 })
  assert.throws(() => ledger.begin('analysis', 3000), /token.*budget exceeded/)
  assert.equal(ledger.usage().inputTokens, 6000)
})

const budget = defaultReviewBudget({
  maxTokens: 10_000,
  maxCalls: 6,
  deadlineMs: 10_000,
  reserveForOutput: 500,
  reserveForVerification: 500,
  contextMaxTokens: 2_000,
  contextReserveForOutput: 200,
})

test('compiles explicit hierarchical budgets and preserves output/verification reserves', () => {
  assert.equal(budget.campaign.reserveForOutput, 500)
  assert.equal(budget.campaign.reserveForVerification, 500)
  assert.ok(budget.pullRequest.maxTokens < budget.campaign.maxTokens)
  assert.throws(() => compileReviewBudget({ ...budget, pullRequest: { ...budget.pullRequest, maxCalls: budget.campaign.maxCalls } }), /leave campaign capacity/)
})

test('provider-free compilation rejects impossible minimum capacity', () => {
  assert.throws(() => defaultReviewBudget({
    maxTokens: 100,
    maxCalls: 2,
    deadlineMs: 100,
    reserveForOutput: 50,
    reserveForVerification: 50,
    contextMaxTokens: 20,
    contextReserveForOutput: 1,
}), /leave input capacity/)
})

test('analysis budget spans all context packs but remains under the PR ceiling', () => {
  assert.ok(budget.analysis.maxTokens > budget.contextPack.maxTokens)
  assert.equal(
    budget.analysis.maxTokens,
    budget.pullRequest.maxTokens - budget.pullRequest.reserveForOutput - budget.pullRequest.reserveForVerification,
  )
})

test('analysis budget keeps enough declared capacity for a large multi-pack batch', () => {
  assert.ok(budget.pullRequest.maxTokens >= Math.floor((10_000 - 500 - 500) * 0.95))
  assert.ok(budget.analysis.maxTokens > budget.contextPack.maxTokens)
})

test('ledger reserves before concurrent provider execution and accounts dimensions', () => {
  const ledger = createReviewBudgetLedger(budget)
  const first = ledger.begin('analysis', 100)
  const second = ledger.begin('analysis', 100)
  const rest = [ledger.begin('analysis', 100), ledger.begin('analysis', 100), ledger.begin('analysis', 100)]
  assert.throws(() => ledger.begin('analysis', 100), ReviewBudgetExceededError)
  first.finish({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 5, memoryTokens: 0, retryTokens: 0 })
  second.finish({ inputTokens: 100, cachedInputTokens: 10, outputTokens: 8, reasoningOutputTokens: 2, memoryTokens: 0, retryTokens: 0 })
  for (const reservation of rest) reservation.finish({ inputTokens: 100, cachedInputTokens: 10, outputTokens: 8, reasoningOutputTokens: 2, memoryTokens: 0, retryTokens: 0 })
  assert.equal(ledger.usage().providerCalls, 5)
  assert.equal(ledger.usage().inputTokens, 500)
  assert.equal(ledger.usage().cachedInputTokens, 60)
  assert.equal(ledger.usage().wallClockMs >= 0, true)
})

test('missing provider dimensions remain explicitly unavailable', () => {
  const ledger = createReviewBudgetLedger(budget)
  ledger.begin('verification', 10).finish({ inputTokens: 10, outputTokens: 3 })
  const usage = ledger.usage()
  assert.equal(usage.inputTokens, 10)
  assert.equal(usage.outputTokens, 3)
  assert.equal(usage.cachedInputTokens, undefined)
})
