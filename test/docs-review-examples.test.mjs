import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

test('marketing diffs have valid syntax, line ranges, dates and lookups', () => {
  const source = readFileSync(new URL('../apps/docs/components/review-config-demo.tsx', import.meta.url), 'utf8')
  const literal = source.match(/const examples = (\[[\s\S]*?\]) as const/)[1]
  const data = transformSync(`(${literal})`, { loader: 'ts', target: 'esnext' }).code
  const examples = runInNewContext(data)
  for (const item of examples) {
    const fn = runInNewContext(`(${item.header.replace('export ', '')}\n${item.after}\n${item.continuation}\n})`)
    assert.equal(typeof fn, 'function')
    assert.ok(Number(item.line) > 1)
    assert.notEqual(item.continuation, '}')
  }
  const date = runInNewContext(`(${examples[3].header.replace('export ', '')}\n${examples[3].after}\n})`)
  assert.equal(date('2026-09-29').toISOString(), '2026-09-29T00:00:00.000Z')
  const match = runInNewContext(`(${examples[2].header.replace('export ', '')}\n${examples[2].after}\n${examples[2].continuation}\n})`)
  const row = { id: 'a' }
  assert.equal(match([{id: 'a'}], [row])[0], row)
  assert.doesNotMatch(source, /<span>40<|<span>43</)
})
