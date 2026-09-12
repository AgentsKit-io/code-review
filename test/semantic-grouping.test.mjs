import assert from 'node:assert/strict'
import test from 'node:test'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'

// A large-enough changed-file set (many small files) so the combined-line and file-count
// thresholds are both met, without needing genuinely large fixtures.
function manyFiles(count, linesEach = 60) {
  const body = Array.from({ length: linesEach }, (_, i) => `export const line${i} = ${i}`).join('\n')
  const files = {}
  for (let i = 0; i < count; i++) files[`pkg/module${i}.ts`] = body
  return files
}

function fakeAdapter(onToolCall) {
  const calls = []
  return {
    calls,
    inference: {
      createSource(request) {
        return {
          async *stream() {
            const tool = request.context.tools[0]
            const prompt = request.messages.map((message) => message.content).join('\n')
            calls.push({ name: tool.name, prompt })
            const args = onToolCall(tool.name, prompt)
            yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
            yield { type: 'done' }
          },
        }
      },
    },
  }
}

function scmAdapter(files) {
  return {
    async diff() { return { headRevision: 'head', complete: true, files: Object.entries(files).map(([path, content]) => ({ path, status: 'added', patch: '@@ -0,0 +1 @@\n+' + content })) } },
    async fileContent(ref, file) { return { content: files[file], truncated: false } },
  }
}

test('semantic grouping clusters files by index once thresholds are met, on a real run', async () => {
  const files = manyFiles(5)
  const { calls, inference } = fakeAdapter((name) => {
    if (name === 'submit_file_groups') return { groups: [[0, 2], [1], [3], [4]] }
    if (name === 'submit_verdicts') return { verdicts: [] }
    return { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
  })
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { grouping: 'semantic', groupingMinFiles: 4, groupingMinLines: 100, maxRelatedFiles: 1 },
    consolidate: false,
    reporters: [],
  })
  const review = await agent.run()
  assert.ok(calls.some((call) => call.name === 'submit_file_groups'), 'the semantic grouping call must have been made')
  const contextPacks = review.evidence.contextPacks ?? []
  // Two files (module0, module2) should share one context pack; the heuristic (no shared
  // basename/import relation between these files) would never have grouped them.
  const groupedPack = contextPacks.find((pack) => pack.files.includes('pkg/module0.ts') && pack.files.includes('pkg/module2.ts'))
  assert.ok(groupedPack, 'module0 and module2 must share a context pack per the model-clustered groups')
  assert.equal(new Set(contextPacks.flatMap((pack) => pack.files)).size, 5, 'every file must still be reviewed exactly once')
})

test('plan() stays provider-free even when semantic grouping is configured and thresholds are met', async () => {
  const files = manyFiles(5)
  const { calls, inference } = fakeAdapter(() => { throw new Error('plan() must never call the provider') })
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { grouping: 'semantic', groupingMinFiles: 4, groupingMinLines: 100 },
    consolidate: false,
    reporters: [],
  })
  const plan = await agent.plan()
  assert.equal(calls.length, 0, 'plan() must not invoke the provider, even for semantic grouping')
  assert.equal(new Set(plan.contextPacks.flatMap((pack) => pack.files)).size, 5, 'plan() still falls back to heuristic grouping and covers every file')
})

test('an out-of-range or duplicate index from the model is dropped, never fabricating or losing a file', async () => {
  const files = manyFiles(4)
  const { inference } = fakeAdapter((name) => {
    if (name === 'submit_file_groups') return { groups: [[0, 0, 999], [1, 2, 3, 3]] }
    if (name === 'submit_verdicts') return { verdicts: [] }
    return { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
  })
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { grouping: 'semantic', groupingMinFiles: 4, groupingMinLines: 100 },
    consolidate: false,
    reporters: [],
  })
  const review = await agent.run()
  const reviewed = (review.evidence.contextPacks ?? []).flatMap((pack) => pack.files)
  assert.equal(new Set(reviewed).size, 4, 'every real file must be reviewed exactly once despite a bogus out-of-range index')
  assert.ok(!reviewed.includes(undefined))
})

test('semantic grouping is skipped below the configured file/line thresholds, even on a real run', async () => {
  const files = manyFiles(2, 5)
  const { calls, inference } = fakeAdapter((name) => {
    if (name === 'submit_verdicts') return { verdicts: [] }
    return { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
  })
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { grouping: 'semantic', groupingMinFiles: 4, groupingMinLines: 100 },
    consolidate: false,
    reporters: [],
  })
  await agent.run()
  assert.ok(!calls.some((call) => call.name === 'submit_file_groups'), 'below threshold, the grouping call must never be made')
})

test('a failed grouping call falls back to heuristic grouping rather than failing the review', async () => {
  const files = manyFiles(4)
  const { inference } = fakeAdapter((name) => {
    if (name === 'submit_file_groups') return { groups: 'not-an-array' } // fails schema validation
    if (name === 'submit_verdicts') return { verdicts: [] }
    return { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
  })
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { grouping: 'semantic', groupingMinFiles: 4, groupingMinLines: 100 },
    consolidate: false,
    reporters: [],
  })
  const review = await agent.run()
  const reviewed = (review.evidence.contextPacks ?? []).flatMap((pack) => pack.files)
  assert.equal(new Set(reviewed).size, 4, 'a malformed grouping response must not lose or duplicate a file')
})
