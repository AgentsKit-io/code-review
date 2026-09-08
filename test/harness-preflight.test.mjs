import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('preflight forwards policy overrides to the internal planner', () => {
  const source = readFileSync(new URL('../scripts/review-harness.mjs', import.meta.url), 'utf8')
  assert.match(source, /'deadline-ms'/)
  assert.match(source, /'max-calls'/)
  assert.match(source, /'min-confidence'/)
})
