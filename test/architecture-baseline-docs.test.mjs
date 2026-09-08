import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('issue 138 records all four approved architecture decisions', () => {
  const decisions = [
    'docs/adr/0002-deterministic-campaign-engine.md',
    'docs/adr/0003-model-and-scm-adapter-boundaries.md',
    'docs/adr/0004-diff-first-context-and-token-budgets.md',
    'docs/adr/0005-separated-safe-review-memory.md',
  ]
  for (const path of decisions) {
    const document = read(path)
    assert.match(document, /## Status\n\nAccepted/)
    assert.match(document, /## Alternatives Considered/)
    assert.match(document, /#137/)
  }
})

test('baseline protocol separates committed contracts from local study evidence', () => {
  const document = read('docs/baseline-protocol.md')
  assert.match(document, /synthetic process evidence/i)
  assert.match(document, /real pull-request evidence/i)
  assert.match(document, /real campaign evidence/i)
  assert.match(document, /outside the repository/i)
  assert.match(document, /75%/)
  assert.match(document, /three times/i)
})
