import assert from 'node:assert/strict'
import test from 'node:test'
// Deliberately import from the package's own public entry point, exactly the path an
// external consumer resolves via `@agentskit/code-review` — never a relative path into
// agents/code-review/*.js. This is the class of gap issue #275 found: every internal
// test elsewhere in this suite imports the same way an external consumer cannot, so it
// never caught that createCodeReviewAgent (and reporters) were missing from src/index.ts.
import * as publicApi from '../dist/src/index.js'

test('createCodeReviewAgent and its reviewing config are part of the public API surface', () => {
  assert.equal(typeof publicApi.createCodeReviewAgent, 'function')
  assert.equal(typeof publicApi.builtInLenses, 'function')
  assert.equal(typeof publicApi.ReviewPreflightError, 'function')
  assert.equal(typeof publicApi.ReviewDeadlineError, 'function')
  assert.equal(typeof publicApi.ReviewExecutionError, 'function')
})

test('reporters are part of the public API surface, not only usable by the bundled CLI', () => {
  for (const name of ['markdownReporter', 'sarifReporter', 'renderMarkdown', 'renderGithubWalkthrough', 'scmReviewReporter', 'githubSummaryReporter', 'githubInlineReporter']) {
    assert.equal(typeof publicApi[name], 'function', `${name} must be exported`)
  }
})

test('an external consumer can actually run a review end to end through the public entry point', async () => {
  const fakeAdapter = {
    createSource(request) {
      return { async *stream() {
        const tool = request.context.tools[0]
        const args = tool.name === 'submit_verdicts' ? { verdicts: [] } : { completedCategories: ['correctness', 'security', 'tests'], analysis: ['checked'], findings: [] }
        yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
        yield { type: 'done' }
      } }
    },
  }
  const agent = publicApi.createCodeReviewAgent({
    source: { kind: 'stdin', filename: 'x.ts', content: 'export const x = 1\n' },
    adapter: fakeAdapter,
    auditVotes: 1,
    consolidate: false,
    reporters: [],
    // The exact options issue #275 found unreachable: exercised here through the public
    // entry point, not an internal relative import.
    rules: { enabled: false },
    verification: { posture: 'strict' },
    context: { grouping: 'heuristic' },
  })
  const review = await agent.run()
  assert.equal(review.verdict, 'APPROVE')
  assert.equal(review.coverage.reviewedFiles, 1)
})
