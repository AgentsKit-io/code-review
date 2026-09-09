import type { DomainFailure } from './domain-contracts.js'

const detail = (error: unknown) => error instanceof Error ? error.message : String(error)
const code = (error: unknown) => (error as { code?: string }).code

export function normalizeProviderFailure(error: unknown, operation = 'provider execution'): DomainFailure {
  const message = detail(error).slice(0, 2_000) || 'provider execution failed'
  const errorCode = code(error)
  if (errorCode === 'ETIMEDOUT' || /\b(?:timed out|timeout)\b/i.test(message)) {
    return { disposition: 'RETRYABLE', code: 'PROVIDER_TIMEOUT', operation, message, retryAfterMs: 250 }
  }
  if (errorCode === 'ABORT_ERR' || /\b(?:cancelled|canceled|aborted)\b/i.test(message)) {
    return { disposition: 'CANCELLED', code: 'PROVIDER_CANCELLED', operation, message }
  }
  if (/(?:failed to authenticate|authentication failed|access token has been revoked|oauth[^\n]*(?:revoked|invalid|expired)|(?:invalid|missing) (?:api )?key|\b(?:401|403)\b[^\n]*(?:auth|token|credential))/i.test(message)) {
    return { disposition: 'TERMINAL', code: 'PROVIDER_AUTHENTICATION_FAILED', operation, message }
  }
  if (/\b(?:429|rate limit(?:ed)?|too many requests)\b/i.test(message)) {
    const retryAfterMs = Number(message.match(/retry[- ]after-ms[=: ]+(\d+)/i)?.[1] ?? 1_000)
    return { disposition: 'RETRYABLE', code: 'PROVIDER_RATE_LIMITED', operation, message, retryAfterMs }
  }
  if (/\b5\d\d\b|\b(?:server|service) (?:error|unavailable)\b/i.test(message)) {
    return { disposition: 'RETRYABLE', code: 'PROVIDER_SERVER_ERROR', operation, message, retryAfterMs: 500 }
  }
  if (/\b(?:malformed|invalid structured|did not submit|invalid (?:json|output))\b/i.test(message)) {
    return { disposition: 'RETRYABLE', code: 'PROVIDER_INVALID_OUTPUT', operation, message, retryAfterMs: 100 }
  }
  return { disposition: 'TERMINAL', code: 'PROVIDER_FAILED', operation, message }
}

export function providerRetryDelay(failure: DomainFailure, attempt: number, random = Math.random, maximumMs = 10_000): number {
  if (failure.disposition !== 'RETRYABLE') throw new Error('only retryable provider failures have a retry delay')
  const exponential = Math.max(failure.retryAfterMs, 100 * (2 ** Math.max(0, attempt)))
  return Math.min(maximumMs, Math.round(exponential * (0.75 + Math.min(1, Math.max(0, random())) * 0.5)))
}

export function waitForProviderRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('provider retry cancelled'), { code: 'ABORT_ERR' }))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delayMs)
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('provider retry cancelled'), { code: 'ABORT_ERR' })) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class AdaptiveConcurrencyGate {
  private active = 0
  private ceiling: number
  private successes = 0
  private readonly queue: Array<{ run: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void }> = []

  constructor(readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error('provider concurrency must be a positive integer')
    this.ceiling = maximum
  }

  get current(): number { return this.ceiling }

  reset(): void { this.ceiling = this.maximum; this.successes = 0 }

  recordInstability(): void { this.ceiling = Math.max(1, this.ceiling - 1); this.successes = 0 }

  recordSuccess(): void {
    if (this.ceiling >= this.maximum) return
    if (++this.successes >= this.ceiling * 2) { this.ceiling++; this.successes = 0; this.next() }
  }

  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(Object.assign(new Error('provider call aborted before start'), { code: 'ABORT_ERR' })); return }
      const item = { signal, reject, run: () => operation().then(resolve, reject).finally(() => { this.active--; this.next() }), abort: undefined as (() => void) | undefined }
      item.abort = () => {
        const index = this.queue.indexOf(item)
        if (index < 0) return
        this.queue.splice(index, 1)
        reject(Object.assign(new Error('provider call aborted before start'), { code: 'ABORT_ERR' }))
      }
      signal?.addEventListener('abort', item.abort, { once: true })
      this.queue.push(item)
      this.next()
    })
  }

  private next(): void {
    while (this.active < this.ceiling && this.queue.length) {
      const item = this.queue.shift()!
      if (item.abort) item.signal?.removeEventListener('abort', item.abort)
      if (item.signal?.aborted) { item.reject(Object.assign(new Error('provider call aborted before start'), { code: 'ABORT_ERR' })); continue }
      this.active++
      item.run()
    }
  }
}
