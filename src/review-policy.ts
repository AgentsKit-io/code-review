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
  const lenses = config.batching.enabled
    ? Object.fromEntries(Object.entries(config.lenses).map(([key, policy]) => [key, { ...policy, enabled: policy.required }]))
    : config.lenses
  return reviewFingerprint({
    engine: `@agentskit/code-review@${packageVersion()}`,
    provider: config.provider, model: config.model, transport: config.transport, lenses, votes: config.votes,
    retries: config.batching.enabled ? 0 : config.retries,
    profile: config.batching.enabled ? 'batched-policy' : config.profile,
    thresholds: config.batching.enabled ? { ...config.thresholds, maxPerFile: 1 } : config.thresholds,
    budget: config.budget, context: config.context, redaction: config.redaction,
    conventions: config.conventions ?? 'auto', batching: config.batching,
  })
}
