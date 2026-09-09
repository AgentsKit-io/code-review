import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen(server.address()))
  })
}

function close(server) {
  return new Promise(resolveClose => server.close(resolveClose))
}

function runCli(args, input) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['dist/src/cli.js', ...args], { cwd: root })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', status => resolveRun({ status, stdout, stderr }))
    child.stdin.end(input)
  })
}

test('the built CLI completes a structured local Ollama review', async () => {
  const requests = []
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      const body = JSON.parse(raw)
      requests.push(body)
      const tool = body.tools[0].function.name
      const arguments_ = tool === 'submit_batched_findings'
        ? { completedCategories: ['correctness', 'security', 'performance', 'maintainability', 'design', 'tests', 'conventions'], findings: [] }
        : { findings: [] }
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.end([
        JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: tool, arguments: arguments_ } }],
          },
          done: false,
        }),
        JSON.stringify({ done: true, prompt_eval_count: 8, eval_count: 2 }),
        '',
      ].join('\n'))
    })
  })
  const address = await listen(server)

  try {
    const run = await runCli([
      '--provider', 'ollama',
      '--model', 'fixture-model',
      '--base-url', `http://127.0.0.1:${address.port}`,
      '--stdin',
      '--lang', 'ts',
      '--concurrency', '1',
      '--no-fail',
    ], 'export const answer = 42\n')

    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`)
    assert.equal(requests.length, 1, `unexpected Ollama request count: ${requests.length}`)
    assert.ok(requests.every(body => body.model === 'fixture-model'))
    assert.ok(requests.every(body => body.messages[0].role === 'system'))
    assert.ok(requests.every(body => /untrusted/i.test(body.messages[0].content)))
    assert.ok(requests.every(body => body.tools[0].function.name === 'submit_batched_findings'))
    assert.equal(requests.some(body => body.messages.some(message => message.role === 'assistant' || message.role === 'tool')), false)
    assert.match(run.stdout, /Code review — APPROVE/)
    assert.match(run.stdout, /1\/1 lens executions succeeded/)
  } finally {
    await close(server)
  }
})
