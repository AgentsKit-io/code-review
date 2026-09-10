import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createCodeReviewAgent, builtInLenses } from '../dist/agents/code-review/agent.js'
import { codexCli } from '../dist/src/codex-adapter.js'
import { multidimensionalLens, skeptic } from '../dist/agents/code-review/lenses.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureBin = join(root, 'test/fixtures/bin')
const categories = ['correctness', 'security', 'performance', 'maintainability', 'design', 'tests', 'conventions']

test('single, combined, and skeptical review share runtime-evidence and changed-line safeguards', () => {
  for (const skill of [...builtInLenses(categories).map(lens => lens.skill), multidimensionalLens(categories), skeptic]) {
    assert.match(skill.systemPrompt, /anchor\s+to a changed line/)
    assert.match(skill.systemPrompt, /ZodNumber\/ZodString do not reveal int\/min\/max\/refine checks/)
    assert.match(skill.systemPrompt, /Require implementation evidence for a runtime claim/)
    assert.match(skill.systemPrompt, /Still\s+report defects directly demonstrated by executable source/)
  }
})

function run(source, extraEnv = {}, votes = 3) {
  const directory = mkdtempSync(join(tmpdir(), 'multidimensional-review-'))
  const result = join(directory, 'result.json')
  const command = spawnSync(process.execPath, [
    'dist/src/cli.js', '--provider', 'codex-cli', '--stdin', '--lang', 'ts',
    '--health-check', 'off', '--votes', String(votes), '--result', result, '--no-fail',
  ], { cwd: root, input: source, encoding: 'utf8', env: { ...process.env, ...extraEnv, PATH: `${fixtureBin}:${process.env.PATH ?? ''}` } })
  const artifact = JSON.parse(readFileSync(result, 'utf8'))
  rmSync(directory, { recursive: true, force: true })
  return { command, artifact }
}

async function runStrategy(source, batchLenses) {
  const previous = { path: process.env.PATH, corpus: process.env.CODEX_FIXTURE_QUALITY_CORPUS }
  process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
  process.env.CODEX_FIXTURE_QUALITY_CORPUS = '1'
  let tokensUsed = 0
  try {
    const agent = createCodeReviewAgent({
      adapter: codexCli({ onUsage: (usage) => { tokensUsed += usage.inputTokens + usage.outputTokens } }),
      source: { kind: 'stdin', content: source, filename: 'snippet.ts' },
      lenses: builtInLenses(categories), requiredLenses: ['correctness', 'security', 'tests'],
      batchLenses, auditVotes: 1, reporters: [],
    })
    return { review: await agent.run(), tokensUsed }
  } finally {
    process.env.PATH = previous.path
    if (previous.corpus === undefined) delete process.env.CODEX_FIXTURE_QUALITY_CORPUS
    else process.env.CODEX_FIXTURE_QUALITY_CORPUS = previous.corpus
  }
}

test('a normal context pack reports all seven dimensions from one structured analysis call', () => {
  const { command, artifact } = run('export const answer = 42\n')
  assert.equal(command.status, 0, command.stderr)
  assert.deepEqual(artifact.enabledCategories, categories)
  assert.deepEqual(artifact.completedCategories, categories)
  assert.deepEqual(artifact.execution, { attempted: 1, succeeded: 1, failed: 0 })
  assert.equal(artifact.evidence.providerCalls, 1)
  assert.ok(artifact.evidence.tokensUsed > 0)
})

test('omitting a required category is explicit, incomplete, and non-approving', () => {
  const { command, artifact } = run('export const answer = 42\n', { CODEX_FIXTURE_OMIT_CATEGORY: 'security' })
  assert.equal(command.status, 2, command.stderr)
  assert.equal(artifact.incomplete, true)
  assert.equal(artifact.verdict, 'COMMENT')
  assert.deepEqual(artifact.missingRequiredLenses, ['security'])
  assert.equal(artifact.completedCategories.includes('security'), false)
})

test('the fixed quality corpus preserves expected detections with measured call and token reduction', async () => {
  const corpus = JSON.parse(readFileSync(join(root, 'quality/corpus/default.json'), 'utf8'))
  for (const fixture of corpus.cases) {
    const expected = fixture.findings[0]
    const multidimensional = await runStrategy(fixture.source, true)
    const baseline = await runStrategy(fixture.source, false)
    for (const result of [multidimensional, baseline]) {
      assert.equal(result.review.findings.length, 1, `${fixture.id}: expected detection was lost`)
      assert.ok(Math.abs(result.review.findings[0].line - expected.line) <= expected.lineTolerance)
      assert.equal(result.review.findings[0].severity, expected.severity)
      assert.ok(expected.titleIncludes.some((word) => result.review.findings[0].title.toLowerCase().includes(word)))
    }
    assert.equal(multidimensional.review.execution.attempted, 2)
    assert.equal(baseline.review.execution.attempted, 7)
    assert.ok(multidimensional.review.evidence.providerCalls <= baseline.review.evidence.providerCalls / 2)
    assert.ok(multidimensional.tokensUsed <= baseline.tokensUsed / 2)
  }
})
