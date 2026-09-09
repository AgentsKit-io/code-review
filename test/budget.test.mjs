import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ReviewBudgetExceededError,
  compileReviewBudget,
  createReviewBudgetLedger,
  defaultReviewBudget,
} from '../dist/src/budget.js'

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
