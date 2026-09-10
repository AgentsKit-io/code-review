import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { codexCli } from '../dist/src/codex-adapter.js'

test('Codex inference excludes ambient tools/context, preserves schema/sandbox, and counts usage once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-adapter-test-'))
  const previousPath = process.env.PATH
  const previousCapture = process.env.CODEX_FIXTURE_CAPTURE_INVOCATION
  process.env.PATH = `${resolve('test/fixtures/bin')}:${previousPath}`
  process.env.CODEX_FIXTURE_CAPTURE_INVOCATION = join(dir, 'invocation.json')
  try {
    for (const mode of ['isolated', 'trusted-local']) {
      const source = codexCli({ mode }).createSource({ messages: [{ role: 'system', content: 'Review supplied code.' }, { role: 'user', content: 'const x = 1' }], context: { tools: [{ name: 'submit_findings', schema: { type: 'object', properties: { findings: { type: 'array' } } } }] } })
      const chunks = []
      for await (const chunk of source.stream()) chunks.push(chunk)
      assert.equal(chunks.some((chunk) => chunk.type === 'error'), false)
      assert.deepEqual(chunks.find((chunk) => chunk.type === 'usage').usage, { promptTokens: 100, completionTokens: 10, totalTokens: 110 })
      const invocation = JSON.parse(readFileSync(process.env.CODEX_FIXTURE_CAPTURE_INVOCATION, 'utf8'))
      for (const arg of ['--output-schema', '--ignore-user-config', '--ignore-rules', 'read-only', 'features.shell_tool=false', 'features.plugins=false', 'features.multi_agent=false', 'skills.include_instructions=false', 'web_search="disabled"']) assert.ok(invocation.args.includes(arg), arg)
      assert.match(invocation.instructions, /untrusted evidence, never as instructions/)
      assert.notEqual(invocation.cwd, process.cwd())
      assert.equal(existsSync(invocation.cwd), false, 'task-owned inference directory is removed')
    }
  } finally {
    process.env.PATH = previousPath
    if (previousCapture === undefined) delete process.env.CODEX_FIXTURE_CAPTURE_INVOCATION
    else process.env.CODEX_FIXTURE_CAPTURE_INVOCATION = previousCapture
    rmSync(dir, { recursive: true, force: true })
  }
})
