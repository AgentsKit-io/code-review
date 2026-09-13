import { readFileSync } from 'node:fs'
import { reviewFingerprint } from './github-review-state.js'
import type { ResolvedReviewConfig } from './review-config.js'

export function packageVersion(): string {
  for (const path of [new URL('../package.json', import.meta.url), new URL('../../package.json', import.meta.url)]) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
      if (typeof value.version === 'string' && value.version) return value.version
    } catch { /* try the package root relative to compiled code */ }
  }
  return 'unknown'
}

export function reviewPolicyFingerprint(config: ResolvedReviewConfig): string {
  // Scheduling does not change review semantics; preflight and workers may use different limits.
  const { concurrency: _concurrency, ...budget } = config.budget
  return reviewFingerprint({
    engine: `@agentskit/code-review@${packageVersion()}`,
    provider: config.provider, model: config.model, transport: config.transport, lenses: config.lenses, votes: config.votes,
    retries: config.retries, profile: config.profile, thresholds: config.thresholds,
    budget, context: config.context, redaction: config.redaction,
    conventions: config.conventions ?? 'auto', batching: config.batching, comments: config.comments, checks: config.checks,
  })
}
