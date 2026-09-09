import assert from 'node:assert/strict'
import test from 'node:test'
import { AdaptiveConcurrencyGate, normalizeProviderFailure, providerRetryDelay, waitForProviderRetry } from '../dist/src/provider-execution.js'
import { ProviderCircuitBreaker, ProviderCircuitOpenError } from '../dist/src/provider-circuit-breaker.js'

test('provider faults normalize to safe typed dispositions', () => {
  const cases = [
    [Object.assign(new Error('worker stopped'), { code: 'ETIMEDOUT' }), 'RETRYABLE', 'PROVIDER_TIMEOUT'],
    [new Error('429 too many requests retry-after-ms=75'), 'RETRYABLE', 'PROVIDER_RATE_LIMITED'],
    [new Error('503 service unavailable'), 'RETRYABLE', 'PROVIDER_SERVER_ERROR'],
    [new Error('authentication failed: invalid API key'), 'TERMINAL', 'PROVIDER_AUTHENTICATION_FAILED'],
    [new Error('invalid structured output'), 'RETRYABLE', 'PROVIDER_INVALID_OUTPUT'],
    [Object.assign(new Error('worker aborted'), { code: 'ABORT_ERR' }), 'CANCELLED', 'PROVIDER_CANCELLED'],
    [new Error('socket exploded'), 'TERMINAL', 'PROVIDER_FAILED'],
  ]
  for (const [error, disposition, code] of cases) {
    const failure = normalizeProviderFailure(error, 'test')
    assert.equal(failure.disposition, disposition)
    assert.equal(failure.code, code)
  }
})

test('retry backoff is exponential, jittered, bounded, and cancellation-aware', async () => {
  const failure = normalizeProviderFailure(new Error('503 server error'), 'test')
  assert.equal(providerRetryDelay(failure, 0, () => 0.5), 500)
  assert.equal(providerRetryDelay({ ...failure, retryAfterMs: 0 }, 3, () => 0.5), 800)
  assert.equal(providerRetryDelay({ ...failure, retryAfterMs: 50_000 }, 0, () => 1), 10_000)
  assert.throws(() => providerRetryDelay(normalizeProviderFailure(new Error('invalid key'), 'test'), 0), /only retryable/)
  const controller = new AbortController()
  const waiting = waitForProviderRetry(10_000, controller.signal)
  controller.abort()
  await assert.rejects(waiting, (error) => error.code === 'ABORT_ERR')
})

test('adaptive concurrency decreases after instability and recovers within its maximum', async () => {
  const gate = new AdaptiveConcurrencyGate(3)
  gate.recordInstability()
  assert.equal(gate.current, 2)
  let active = 0
  let peak = 0
  await Promise.all(Array.from({ length: 4 }, () => gate.run(async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active--
    gate.recordSuccess()
  })))
  assert.equal(peak, 2)
  assert.equal(gate.current, 3)
})

test('queued provider work is cancelled without waiting for an active call', async () => {
  const gate = new AdaptiveConcurrencyGate(1)
  let release
  const active = gate.run(() => new Promise((resolve) => { release = resolve }))
  const controller = new AbortController()
  const queued = gate.run(async () => 'unexpected', controller.signal)
  controller.abort()
  await assert.rejects(queued, (error) => error.code === 'ABORT_ERR')
  release('done')
  await active
})

test('circuit stops fan-out and allows exactly one controlled recovery probe', () => {
  let now = 100
  const circuit = new ProviderCircuitBreaker(2, 50, () => now)
  circuit.beforeCall(); circuit.recordFailure()
  circuit.beforeCall(); circuit.recordFailure()
  assert.equal(circuit.state, 'open')
  assert.throws(() => circuit.beforeCall(), ProviderCircuitOpenError)
  now = 150
  assert.equal(circuit.state, 'half-open')
  circuit.beforeCall()
  assert.throws(() => circuit.beforeCall(), ProviderCircuitOpenError)
  circuit.recordSuccess()
  assert.equal(circuit.state, 'closed')
})
