import assert from 'node:assert/strict'
import test from 'node:test'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'
import { defaultReviewBudget } from '../dist/src/budget.js'

function scmAdapter(files) {
  return {
    async diff() { return { headRevision: 'head', complete: true, files: Object.entries(files).map(([path, content]) => ({ path, status: 'added', patch: '@@ -0,0 +1 @@\n+' + content })) } },
    async fileContent(ref, file) { return { content: files[file], truncated: false } },
  }
}

function toolArgs(name) {
  if (name === 'submit_verdicts') return { verdicts: [] }
  return { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
}

test('a pack the budget cannot possibly afford is skipped before dispatch, not aborted mid-run', async () => {
  // Two unrelated files land in two separate packs (default heuristic grouping). A tight
  // analysis call ceiling means only one pack can be attempted; before this fix, the
  // second pack would enter gate.run, fail inside budgetLedger.begin(), and — per
  // reviewPack's deliberate re-throw of budget errors — abort the ENTIRE run, discarding
  // the first pack's already-produced finding too.
  const files = { 'a.ts': 'export const a = 1\n', 'b.ts': 'export const b = 2\n' }
  const calls = []
  const inference = {
    createSource(request) {
      return {
        async *stream() {
          const tool = request.context.tools[0]
          const prompt = request.messages.map((m) => m.content).join('\n')
          calls.push(tool.name)
          const args = prompt.includes('FILE: a.ts')
            ? { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked a.ts'], findings: [{ file: 'a.ts', line: 1, endLine: null, severity: 'high', category: 'correctness', confidence: 0.9, title: 'Found in a.ts', rationale: 'Because.', suggestion: 'Fix it.', suggestedPatch: null }] }
            : toolArgs(tool.name)
          yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
          yield { type: 'done' }
        },
      }
    },
  }
  const hierarchy = defaultReviewBudget({ maxTokens: 500_000, maxCalls: 100, deadlineMs: 10_000, reserveForOutput: 2_000, reserveForVerification: 2_000, contextMaxTokens: 16_000, contextReserveForOutput: 2_000 })
  hierarchy.analysis.maxCalls = 1
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { maxRelatedFiles: 1 },
    budget: { maxTokens: 500_000, maxCalls: 100, deadlineMs: 10_000, hierarchy },
    consolidate: false,
    auditVotes: 1,
    reporters: [],
  })
  const review = await agent.run()
  assert.equal(review.incomplete, true, 'a budget-skipped file makes the review incomplete')
  assert.ok(review.findings.some((f) => f.title === 'Found in a.ts'), 'the affordable pack\'s real finding must survive, not be discarded by the other pack\'s budget failure')
  assert.ok(review.unreviewed?.some((entry) => /over the analysis token\/call budget/.test(entry.reason)), 'the skipped file must be marked with the real reason, not a crash')
})

test('a pack that finishes analysis before the deadline keeps its finding, surfaced as unverified', async () => {
  // Two packs: one resolves immediately with a real finding, the other never resolves
  // until the deadline aborts it. Before this fix, ANY deadline during analysis
  // discarded every candidate finding unconditionally, including this survivor's.
  const files = { 'fast.ts': 'export const fast = 1\n', 'slow.ts': 'export const slow = 2\n' }
  const inference = {
    createSource(request) {
      const tool = request.context.tools[0]
      const prompt = request.messages.map((m) => m.content).join('\n')
      if (prompt.includes('FILE: slow.ts')) {
        return {
          async *stream() {
            await new Promise(() => {}) // never resolves; only the deadline abort ends this
          },
          abort() { /* no cleanup needed for this fixture */ },
        }
      }
      return {
        async *stream() {
          const args = prompt.includes('FILE: fast.ts')
            ? { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked fast.ts'], findings: [{ file: 'fast.ts', line: 1, endLine: null, severity: 'high', category: 'correctness', confidence: 0.9, title: 'Found in fast.ts', rationale: 'Because.', suggestion: 'Fix it.', suggestedPatch: null }] }
            : toolArgs(tool.name)
          yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
          yield { type: 'done' }
        },
      }
    },
  }
  const agent = createCodeReviewAgent({
    source: { kind: 'scm', adapter: scmAdapter(files), ref: { repository: 'org/repo', id: '1' } },
    adapter: inference,
    context: { maxRelatedFiles: 1 },
    budget: { maxTokens: 500_000, maxCalls: 100, concurrency: 8, deadlineMs: 250 },
    consolidate: false,
    auditVotes: 1,
    reporters: [],
  })
  const review = await agent.run()
  assert.equal(review.incomplete, true)
  assert.equal(review.evidence.deadlineExceeded, true)
  const survivor = review.findings.find((f) => f.title === 'Found in fast.ts')
  assert.ok(survivor, 'a finding from a pack that finished before the deadline must reach the report, not be discarded')
  assert.equal(survivor.verification, 'unverified', 'verification itself is also cut short by the same deadline, so it is marked unverified rather than silently approved')
  assert.ok(review.unreviewed?.some((entry) => entry.file === 'slow.ts' && /deadline exceeded/.test(entry.reason)))
})
