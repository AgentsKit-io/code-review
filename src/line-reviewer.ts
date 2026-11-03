/**
 * Requirement RF-10 (`mvp:RF-10`): the decision of the factory line's review stage when Code Review is
 * its reviewer. Fail closed: Code Review decides only when the benchmark report of this package version
 * is `PASS`, and a failed or incomplete review never approves. It falls back to the incumbent, or
 * blocks when the line is configured without one. `scripts/line-review.mjs` runs the review; this
 * module only decides.
 */
export type LineDecision = 'approve' | 'request_changes' | 'fallback' | 'block'
/** What a failed or incomplete review turns into: the incumbent reviews instead, or the PR is blocked. */
export type LineFailurePolicy = 'incumbent' | 'block'

/** The fields of a `--result` review that the decision reads. */
export interface LineReviewResult {
  verdict: string
  blocking: boolean
  incomplete: boolean
  unreviewed?: unknown[]
  missingRequiredLenses?: unknown[]
  execution?: { attempted?: number; succeeded?: number; failed?: number }
  evidence?: { deadlineExceeded?: boolean }
}

export interface LineReviewInput {
  /** `decision` of the benchmark report shipped with this version (`quality/benchmark/report.json`). */
  benchmarkDecision: unknown
  /** The review result; absent when the run failed before writing one. */
  review?: LineReviewResult
  /** Why the run failed (non-zero exit, no result, nothing reviewable). */
  failure?: string
  onFailure?: LineFailurePolicy
}

export interface LineReviewDecision {
  decision: LineDecision
  /** Who decides the PR: Code Review, the incumbent (fallback), or nobody (blocked). */
  decidedBy: 'code-review' | 'incumbent' | 'none'
  reason: string
}

export function parseLineFailurePolicy(value: string | undefined): LineFailurePolicy {
  if (value === undefined || value === '' || value === 'incumbent') return 'incumbent'
  if (value === 'block') return 'block'
  throw new Error(`on-failure policy must be incumbent or block, got ${JSON.stringify(value)}`)
}

/** Why a review cannot approve, or undefined for a complete review. Mirrors the CLI's consolidation check. */
export function incompleteReason(review: LineReviewResult): string | undefined {
  if (review.incomplete) return 'the review is incomplete'
  if (review.unreviewed?.length) return `${review.unreviewed.length} file(s) were not reviewed`
  if (review.missingRequiredLenses?.length) return 'required review lenses did not run'
  if (review.evidence?.deadlineExceeded) return 'the review deadline was exceeded'
  const execution = review.execution
  if (!execution) return 'the review has no execution evidence'
  if (execution.failed) return `${execution.failed} lens execution(s) failed`
  if (execution.succeeded !== execution.attempted) return 'not every lens execution succeeded'
  return undefined
}

export function decideLineReview(input: LineReviewInput): LineReviewDecision {
  if (input.benchmarkDecision !== 'PASS') {
    return { decision: 'fallback', decidedBy: 'incumbent', reason: `benchmark decision is ${String(input.benchmarkDecision ?? 'missing')}, not PASS; the incumbent stays the reviewer` }
  }
  const notDone = input.failure ?? (input.review ? incompleteReason(input.review) : 'the review produced no result')
  if (notDone) {
    return (input.onFailure ?? 'incumbent') === 'block'
      ? { decision: 'block', decidedBy: 'none', reason: `${notDone}; blocked, never approved` }
      : { decision: 'fallback', decidedBy: 'incumbent', reason: `${notDone}; the incumbent reviews this PR` }
  }
  const review = input.review!
  if (review.blocking || review.verdict === 'REQUEST CHANGES') return { decision: 'request_changes', decidedBy: 'code-review', reason: 'complete review with findings that block' }
  return { decision: 'approve', decidedBy: 'code-review', reason: 'complete review with no blocking findings' }
}

/** Exit code of `agentskit-line-review`: only an approval exits 0. */
export const LINE_DECISION_EXIT: Record<LineDecision, number> = { approve: 0, request_changes: 1, block: 2, fallback: 3 }
