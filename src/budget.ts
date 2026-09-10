import { z } from 'zod'

const positive = z.number().int().positive()
const nonNegative = z.number().int().nonnegative()

export const ReviewBudgetScopeSchema = z.object({
  maxTokens: positive,
  maxCalls: positive,
  deadlineMs: positive,
  reserveForOutput: nonNegative.default(0),
  reserveForVerification: nonNegative.default(0),
}).strict().superRefine((scope, context) => {
  if (scope.reserveForOutput + scope.reserveForVerification >= scope.maxTokens) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'output and verification reserves must leave input capacity', path: ['reserveForOutput'] })
  }
})

export const HierarchicalReviewBudgetSchema = z.object({
  campaign: ReviewBudgetScopeSchema,
  pullRequest: ReviewBudgetScopeSchema,
  contextPack: ReviewBudgetScopeSchema,
  analysis: ReviewBudgetScopeSchema,
  verification: ReviewBudgetScopeSchema,
}).strict().superRefine((budget, context) => {
  const parent = budget.campaign
  const pr = budget.pullRequest
  const prTokenLimit = parent.maxTokens - parent.reserveForOutput - parent.reserveForVerification
  if (pr.maxTokens > prTokenLimit) context.addIssue({ code: z.ZodIssueCode.custom, message: 'pull-request budget must leave campaign reserves', path: ['pullRequest', 'maxTokens'] })
  if (pr.maxCalls >= parent.maxCalls) context.addIssue({ code: z.ZodIssueCode.custom, message: 'pull-request call budget must leave campaign capacity', path: ['pullRequest', 'maxCalls'] })
  for (const child of ['contextPack', 'analysis', 'verification'] as const) {
    if (budget[child].maxTokens > pr.maxTokens - pr.reserveForOutput - pr.reserveForVerification) context.addIssue({ code: z.ZodIssueCode.custom, message: `${child} budget exceeds pull-request capacity`, path: [child, 'maxTokens'] })
    if (budget[child].maxCalls > pr.maxCalls) context.addIssue({ code: z.ZodIssueCode.custom, message: `${child} call budget exceeds pull-request capacity`, path: [child, 'maxCalls'] })
    if (budget[child].deadlineMs > pr.deadlineMs) context.addIssue({ code: z.ZodIssueCode.custom, message: `${child} deadline exceeds pull-request deadline`, path: [child, 'deadlineMs'] })
  }
})

export type ReviewBudgetScope = z.infer<typeof ReviewBudgetScopeSchema>
export type HierarchicalReviewBudget = z.infer<typeof HierarchicalReviewBudgetSchema>
export type ReviewBudgetHierarchyInput = Partial<Record<keyof HierarchicalReviewBudget, Partial<ReviewBudgetScope>>>

export type ReviewUsage = {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  memoryTokens?: number
  retryTokens?: number
  providerCalls: number
  wallClockMs: number
}

export function compileReviewBudget(input: unknown): HierarchicalReviewBudget {
  const result = HierarchicalReviewBudgetSchema.safeParse(input)
  if (!result.success) throw new Error(`invalid hierarchical review budget: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  return result.data
}

export function defaultReviewBudget(input: {
  maxTokens: number
  maxCalls: number
  deadlineMs: number
  reserveForOutput: number
  reserveForVerification: number
  contextMaxTokens: number
  contextReserveForOutput: number
  hierarchy?: ReviewBudgetHierarchyInput
}): HierarchicalReviewBudget {
  const campaign = {
    maxTokens: input.maxTokens,
    // A one-call review still needs a parent reservation; the executable
    // ceiling remains the caller's original maxCalls.
    maxCalls: Math.max(2, input.maxCalls),
    deadlineMs: input.deadlineMs,
    reserveForOutput: input.reserveForOutput,
    reserveForVerification: input.reserveForVerification,
  }
  const availableTokens = campaign.maxTokens - campaign.reserveForOutput - campaign.reserveForVerification
  const pullRequest = {
    // Keep the campaign reserves, but leave enough of the declared review
    // budget for one large file split across several context packs.
    maxTokens: Math.max(1, Math.floor(availableTokens * 0.95)),
    maxCalls: Math.max(1, campaign.maxCalls - 1),
    deadlineMs: campaign.deadlineMs,
    reserveForOutput: campaign.reserveForOutput,
    reserveForVerification: campaign.reserveForVerification,
  }
  const child = {
    maxTokens: input.contextMaxTokens,
    maxCalls: Math.min(250, pullRequest.maxCalls),
    deadlineMs: pullRequest.deadlineMs,
    reserveForOutput: input.contextReserveForOutput,
    reserveForVerification: 0,
  }
  // Context packs are individually bounded, while analysis is accumulated
  // across every pack in one review. Reusing the per-pack limit here made a
  // multi-pack review fail after its first few packs even when the PR budget
  // still had capacity.
  const analysis = {
    ...child,
    maxTokens: Math.max(1, pullRequest.maxTokens - pullRequest.reserveForOutput - pullRequest.reserveForVerification),
  }
  const defaults = { campaign, pullRequest, contextPack: child, analysis, verification: { ...analysis, reserveForOutput: 0 } }
  const merged = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { ...value, ...(input.hierarchy?.[key as keyof HierarchicalReviewBudget] ?? {}) }]))
  return compileReviewBudget(merged)
}

export function emptyReviewUsage(): ReviewUsage {
  return { providerCalls: 0, wallClockMs: 0 }
}

export function tightenReviewBudget(budget: HierarchicalReviewBudget, limits: { maxTokens?: number; maxCalls?: number }): HierarchicalReviewBudget {
  const campaign = { ...budget.campaign, maxTokens: Math.min(budget.campaign.maxTokens, limits.maxTokens ?? Infinity), maxCalls: Math.min(budget.campaign.maxCalls, limits.maxCalls ?? Infinity) }
  const pullRequest = { ...budget.pullRequest, maxTokens: Math.min(budget.pullRequest.maxTokens, campaign.maxTokens - campaign.reserveForOutput - campaign.reserveForVerification), maxCalls: Math.min(budget.pullRequest.maxCalls, Math.max(1, campaign.maxCalls - 1)) }
  const child = (scope: ReviewBudgetScope): ReviewBudgetScope => ({ ...scope, maxTokens: Math.min(scope.maxTokens, pullRequest.maxTokens - pullRequest.reserveForOutput - pullRequest.reserveForVerification), maxCalls: Math.min(scope.maxCalls, pullRequest.maxCalls) })
  return compileReviewBudget({ campaign, pullRequest, contextPack: child(budget.contextPack), analysis: child(budget.analysis), verification: child(budget.verification) })
}

function addOptional(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return undefined
  return current === undefined ? next : current + next
}

export function addReviewUsage(current: ReviewUsage, next: Omit<ReviewUsage, 'providerCalls' | 'wallClockMs'> & { providerCalls?: number; wallClockMs?: number }): ReviewUsage {
  return {
    inputTokens: addOptional(current.inputTokens, next.inputTokens),
    cachedInputTokens: addOptional(current.cachedInputTokens, next.cachedInputTokens),
    outputTokens: addOptional(current.outputTokens, next.outputTokens),
    reasoningOutputTokens: addOptional(current.reasoningOutputTokens, next.reasoningOutputTokens),
    memoryTokens: addOptional(current.memoryTokens, next.memoryTokens),
    retryTokens: addOptional(current.retryTokens, next.retryTokens),
    providerCalls: current.providerCalls + (next.providerCalls ?? 0),
    wallClockMs: current.wallClockMs + (next.wallClockMs ?? 0),
  }
}

export class ReviewBudgetExceededError extends Error {
  constructor(readonly scope: keyof HierarchicalReviewBudget, readonly dimension: 'tokens' | 'calls', readonly limit: number) {
    super(`${scope} ${dimension} budget exceeded (${limit})`)
    this.name = 'ReviewBudgetExceededError'
  }
}

export type BudgetReservation = {
  scope: keyof HierarchicalReviewBudget
  estimatedTokens: number
  startedAt: number
  finish(usage?: Omit<ReviewUsage, 'providerCalls' | 'wallClockMs'>): ReviewUsage
}

export function createReviewBudgetLedger(budget: HierarchicalReviewBudget) {
  const usage = emptyReviewUsage()
  const unavailable = new Set<keyof Omit<ReviewUsage, 'providerCalls' | 'wallClockMs'>>()
  let committedTokens = 0
  let reservedTokens = 0
  let reservedCalls = 0

  function begin(scope: keyof HierarchicalReviewBudget, estimatedTokens: number): BudgetReservation {
    if (!Number.isInteger(estimatedTokens) || estimatedTokens < 0) throw new Error('estimated provider input tokens must be a non-negative integer')
    const scopes = [budget.campaign, budget.pullRequest, budget[scope]]
    if (usage.providerCalls + reservedCalls + 1 > Math.min(...scopes.map((candidate) => candidate.maxCalls))) throw new ReviewBudgetExceededError(scope, 'calls', Math.min(...scopes.map((candidate) => candidate.maxCalls)))
    const reserve = budget[scope].reserveForOutput
    const capacities = scopes.map((candidate, index) => candidate.maxTokens - candidate.reserveForVerification - (index < 2 ? candidate.reserveForOutput : 0))
    const capacity = Math.min(...capacities)
    if (committedTokens + reservedTokens + estimatedTokens + reserve > capacity) throw new ReviewBudgetExceededError(scope, 'tokens', capacity)
    reservedTokens += estimatedTokens + reserve
    reservedCalls += 1
    const startedAt = Date.now()
    let finished = false
    return {
      scope,
      estimatedTokens,
      startedAt,
      finish(input) {
        if (finished) return usage
        finished = true
        reservedTokens -= estimatedTokens + reserve
        reservedCalls -= 1
        // Settle reported input + output, or keep the conservative reservation.
        // Cached input and reasoning are subsets, not additional token charges.
        // Missing optional dimensions must not disable enforcement of known usage.
        const measuredTokens = input?.inputTokens !== undefined && input?.outputTokens !== undefined
          ? input.inputTokens + input.outputTokens : estimatedTokens + reserve
        committedTokens += measuredTokens
        const dimensions = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'memoryTokens', 'retryTokens'] as const
        for (const dimension of dimensions) if (input?.[dimension] === undefined) unavailable.add(dimension)
        const measured = input ? { ...input, ...Object.fromEntries([...unavailable].map((dimension) => [dimension, undefined])), providerCalls: 1, wallClockMs: Date.now() - startedAt } : { providerCalls: 1, wallClockMs: Date.now() - startedAt }
        const next = addReviewUsage(usage, measured)
        Object.assign(usage, next)
        if (committedTokens + reservedTokens > capacity) throw new ReviewBudgetExceededError(scope, 'tokens', capacity)
        return usage
      },
    }
  }

  function reset(): void {
    unavailable.clear()
    usage.inputTokens = undefined
    usage.cachedInputTokens = undefined
    usage.outputTokens = undefined
    usage.reasoningOutputTokens = undefined
    usage.memoryTokens = undefined
    usage.retryTokens = undefined
    usage.providerCalls = 0
    usage.wallClockMs = 0
    reservedTokens = 0
    reservedCalls = 0
    committedTokens = 0
  }

  return { begin, usage: () => ({ ...usage }), reset, budget }
}
