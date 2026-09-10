import assert from 'node:assert/strict'
import test from 'node:test'
import { runFaultInjectionHarness, FaultInjectionReportSchema } from '../dist/src/index.js'

test('fault injection harness covers every recovery boundary deterministically', () => {
  const first = runFaultInjectionHarness()
  const second = runFaultInjectionHarness()
  FaultInjectionReportSchema.parse(first)
  assert.deepEqual(second, first)
  assert.equal(first.scenarios.length, 7)
  assert.deepEqual(first.scenarios.map(({ id }) => id), ['provider', 'scm', 'storage', 'clock', 'budget', 'publication', 'merge'])
  assert.ok(first.scenarios.every((scenario) => scenario.status === 'PASS' && scenario.replayStable && scenario.credentialFree && scenario.duplicateMutations === 0))
})
