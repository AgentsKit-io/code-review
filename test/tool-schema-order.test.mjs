import assert from 'node:assert/strict'
import test from 'node:test'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'

// Field order in a structured tool call is load-bearing: a model reasons about the
// fields it emits in the order they are declared, so `analysis` must be serialized
// before the decision it explains (`refuted` for the skeptic, `findings` for a batched
// submission). Zod preserves declaration order through z.toJSONSchema, so this test
// captures the exact JSON Schema handed to the provider and asserts on key order,
// rather than trusting a paraphrase of the source.

test('submit_verdicts places analysis before refuted in the tool schema', async () => {
  const schemas = []
  const inference = { createSource(request) { return { async *stream() {
    const tool = request.context.tools[0]
    schemas.push({ name: tool.name, keys: Object.keys(tool.schema.properties?.verdicts?.items?.properties ?? tool.schema.properties), schema: tool.schema })
    const args = tool.name === 'submit_verdicts'
      ? { verdicts: [{ id: 0, analysis: 'The seeded finding is directly demonstrated by the reviewed source.', refuted: false }] }
      : { completedCategories: ['correctness', 'security', 'tests'], analysis: ['Checked the snippet for correctness, security, and tests.'], findings: [{ file: 'snippet.ts', line: 1, endLine: null, severity: 'high', category: 'correctness', confidence: 0.9, title: 'Example finding', rationale: 'Example rationale.', suggestion: 'Example suggestion.', suggestedPatch: null }] }
    yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
    yield { type: 'done' }
  } } } }
  const agent = createCodeReviewAgent({
    source: { kind: 'stdin', filename: 'snippet.ts', content: 'export function add(a: number, b: number) { return a + b }\n' },
    adapter: inference,
    auditVotes: 1,
    consolidate: false,
    reporters: [],
  })
  await agent.run()
  const verdictsSchema = schemas.find((entry) => entry.name === 'submit_verdicts')
  const batchedSchema = schemas.find((entry) => entry.name === 'submit_batched_findings')
  assert.ok(verdictsSchema, 'expected a submit_verdicts tool call to have been made')
  assert.ok(batchedSchema, 'expected a submit_batched_findings tool call to have been made')
  assert.deepEqual(verdictsSchema.keys, ['id', 'analysis', 'refuted'], 'analysis must be declared before refuted so the model reasons before it commits')
  const analysisIndex = batchedSchema.keys.indexOf('analysis')
  const findingsIndex = batchedSchema.keys.indexOf('findings')
  assert.ok(analysisIndex >= 0, 'batched submission schema must declare analysis')
  assert.ok(analysisIndex < findingsIndex, 'analysis must be declared before findings so the model reasons before it commits')
})

// zod v4's z.toJSONSchema only sets additionalProperties: false when a schema is built
// with .strict() -- the third-party library this codebase used before did that for every
// z.object() implicitly. Every tool-call schema in agent.ts now declares .strict()
// explicitly; this test locks that in so a future schema addition can't silently regress
// to accepting unexpected extra fields from the model.
test('every tool-call schema rejects additional properties, at every nesting level', async () => {
  const schemas = []
  const inference = { createSource(request) { return { async *stream() {
    const tool = request.context.tools[0]
    schemas.push({ name: tool.name, schema: tool.schema })
    const args = tool.name === 'submit_verdicts'
      ? { verdicts: [{ id: 0, analysis: 'The seeded finding is directly demonstrated by the reviewed source.', refuted: false }] }
      : { completedCategories: ['correctness', 'security', 'tests'], analysis: ['Checked the snippet for correctness, security, and tests.'], findings: [{ file: 'snippet.ts', line: 1, endLine: null, severity: 'high', category: 'correctness', confidence: 0.9, title: 'Example finding', rationale: 'Example rationale.', suggestion: 'Example suggestion.', suggestedPatch: null }] }
    yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
    yield { type: 'done' }
  } } } }
  const agent = createCodeReviewAgent({
    source: { kind: 'stdin', filename: 'snippet.ts', content: 'export function add(a: number, b: number) { return a + b }\n' },
    adapter: inference,
    auditVotes: 1,
    consolidate: false,
    reporters: [],
  })
  await agent.run()
  const verdictsSchema = schemas.find((entry) => entry.name === 'submit_verdicts').schema
  const batchedSchema = schemas.find((entry) => entry.name === 'submit_batched_findings').schema
  assert.equal(verdictsSchema.additionalProperties, false, 'submit_verdicts top level must reject extra properties')
  assert.equal(verdictsSchema.properties.verdicts.items.additionalProperties, false, 'each verdict must reject extra properties')
  assert.equal(batchedSchema.additionalProperties, false, 'submit_batched_findings top level must reject extra properties')
  assert.equal(batchedSchema.properties.findings.items.additionalProperties, false, 'each finding must reject extra properties')
})
