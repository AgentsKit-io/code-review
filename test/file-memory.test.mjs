import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { buildMessage } from '@agentskit/core'
import { createFileMemory } from '../dist/src/file-memory.js'

test('self-hosted file memory persists bounded AgentsKit messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentskit-review-memory-'))
  const path = join(dir, 'nested', 'messages.json')
  const memory = createFileMemory(path)
  const message = buildMessage({ role: 'user', content: 'remember this review context', status: 'complete' })
  await memory.save([message])
  const loaded = await memory.load()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].content, message.content)
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1)
})

test('self-hosted file memory fails closed on malformed records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentskit-review-memory-'))
  const path = join(dir, 'messages.json')
  writeFileSync(path, JSON.stringify({ version: 99, messages: [] }))
  await assert.rejects(async () => createFileMemory(path).load(), /unsupported format/)
})

test('self-hosted file memory merges runtime saves instead of truncating history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentskit-review-memory-'))
  const path = join(dir, 'messages.json')
  const memory = createFileMemory(path)
  const first = buildMessage({ role: 'user', content: 'first', status: 'complete' })
  const second = buildMessage({ role: 'assistant', content: 'second', status: 'complete' })
  await memory.save([first])
  await memory.save([second])
  assert.deepEqual((await memory.load()).map((message) => message.content), ['first', 'second'])
})
