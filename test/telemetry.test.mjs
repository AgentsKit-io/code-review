import assert from 'node:assert/strict'
import test from 'node:test'
import { createTelemetryObserver } from '../dist/src/telemetry.js'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'

test('disabled by default: returns undefined without a caller having to check anything', () => {
  assert.equal(createTelemetryObserver(), undefined)
  assert.equal(createTelemetryObserver({}), undefined)
  assert.equal(createTelemetryObserver({ enabled: false }), undefined)
})

test('console exporter writes one JSON span per progress event, never for other event types', async () => {
  const lines = []
  const observer = createTelemetryObserver({ enabled: true, write: (line) => lines.push(line) })
  await observer.on({ type: 'progress', label: 'review', status: 'ok', detail: '3 candidate finding(s)', durationMs: 42 })
  await observer.on({ type: 'run-aborted' })
  await observer.on({ type: 'error', error: new Error('boom') })
  assert.equal(lines.length, 1, 'only the progress event produces a span')
  const span = JSON.parse(lines[0])
  assert.equal(span.name, 'code-review.review')
  assert.deepEqual(span.attributes, [
    { key: 'review.phase', value: { stringValue: 'review' } },
    { key: 'review.status', value: { stringValue: 'ok' } },
  ])
  assert.equal(span.status.code, 1)
  assert.ok(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano) === 42_000_000n, 'the span duration must reflect durationMs exactly')
})

test('an error-status progress event maps to OTLP status code 2', async () => {
  const lines = []
  const observer = createTelemetryObserver({ enabled: true, write: (line) => lines.push(line) })
  await observer.on({ type: 'progress', label: 'verify', status: 'error', durationMs: 5 })
  assert.equal(JSON.parse(lines[0]).status.code, 2)
})

test('contentLogging is off by default and must be explicitly enabled to include detail text', async () => {
  const withoutContent = []
  await createTelemetryObserver({ enabled: true, write: (l) => withoutContent.push(l) }).on({ type: 'progress', label: 'ingest', status: 'skip', detail: 'src/secret-looking-path.ts truncated', durationMs: 1 })
  assert.ok(!withoutContent[0].includes('secret-looking-path'))

  const withContent = []
  await createTelemetryObserver({ enabled: true, contentLogging: true, write: (l) => withContent.push(l) }).on({ type: 'progress', label: 'ingest', status: 'skip', detail: 'src/secret-looking-path.ts truncated', durationMs: 1 })
  assert.ok(withContent[0].includes('secret-looking-path'))
})

test('otlp exporter requires an endpoint and POSTs a valid OTLP/HTTP JSON payload', async () => {
  assert.throws(() => createTelemetryObserver({ enabled: true, exporter: 'otlp' }), /otlpEndpoint/)
  let request
  const observer = createTelemetryObserver({
    enabled: true,
    exporter: 'otlp',
    otlpEndpoint: 'https://collector.example/',
    fetcher: async (url, init) => { request = { url, init }; return new Response(null, { status: 200 }) },
  })
  await observer.on({ type: 'progress', label: 'consolidate', status: 'ok', durationMs: 10 })
  assert.equal(request.url, 'https://collector.example/v1/traces', 'a trailing slash on the configured endpoint must not produce a double slash')
  const body = JSON.parse(request.init.body)
  const span = body.resourceSpans[0].scopeSpans[0].spans[0]
  assert.equal(span.name, 'code-review.consolidate')
  assert.equal(body.resourceSpans[0].resource.attributes[0].value.stringValue, 'agentskit-code-review')
})

test('a collector delivery failure is swallowed: telemetry never fails or blocks the review', async () => {
  const observer = createTelemetryObserver({ enabled: true, exporter: 'otlp', otlpEndpoint: 'https://collector.example', fetcher: async () => { throw new Error('network unreachable') } })
  await assert.doesNotReject(observer.on({ type: 'progress', label: 'review', status: 'ok', durationMs: 1 }))
})

test('createTelemetryObserver composes as a real Observer on a live agent run', async () => {
  const spans = []
  const inference = { createSource(request) { return { async *stream() {
    const tool = request.context.tools[0]
    const args = tool.name === 'submit_verdicts' ? { verdicts: [] } : { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
    yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
    yield { type: 'done' }
  } } } }
  const agent = createCodeReviewAgent({
    source: { kind: 'stdin', filename: 'snippet.ts', content: 'export const x = 1\n' },
    adapter: inference,
    auditVotes: 1,
    consolidate: false,
    reporters: [],
    observers: [createTelemetryObserver({ enabled: true, write: (line) => spans.push(JSON.parse(line)) })],
  })
  await agent.run()
  assert.ok(spans.some((span) => span.name === 'code-review.review'))
  assert.ok(spans.some((span) => span.name === 'code-review.verify'))
})
