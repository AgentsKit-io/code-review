import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createCodeReviewAgent, ReviewPreflightError } from '../dist/agents/code-review/agent.js'
import { loadTargets } from '../dist/agents/code-review/sources.js'
import { codexCli } from '../dist/src/codex-adapter.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const fixtureBin = join(root, 'test/fixtures/bin')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'agentskit-context-pack-'))
  git(cwd, 'init', '-q')
  git(cwd, 'config', 'user.email', 'test@example.com')
  git(cwd, 'config', 'user.name', 'Test')
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(cwd, file, '..'), { recursive: true })
    writeFileSync(join(cwd, file), content)
  }
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-qm', 'baseline')
  return cwd
}

test('changed hunks remain reviewable when the complete file exceeds the old file limit', async () => {
  const cwd = repo({ 'large.ts': Array.from({ length: 400 }, (_, index) => `export const line${index + 1} = ${index + 1}`).join('\n') })
  try {
    const lines = readFileSync(join(cwd, 'large.ts'), 'utf8').split('\n')
    lines[299] = 'export const line300 = 999'
    writeFileSync(join(cwd, 'large.ts'), lines.join('\n'))
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-qm', 'change one line')

    const [target] = await loadTargets({ kind: 'git-diff', base: 'HEAD~1', head: 'HEAD', cwd, limits: { maxFileBytes: 100, contextLines: 2 } })
    assert.equal(target.reviewStatus, undefined)
    assert.equal(target.contextProjection.mode, 'changed-hunks')
    assert.deepEqual(target.contextProjection.includedRanges, [{ start: 298, end: 302 }])
    assert.equal(target.contextProjection.adjacentLines, 2)
    assert.equal(target.contextProjection.requestedAdjacentLines, 2)
    assert.deepEqual(target.sourceLineNumbers, [298, 299, 300, 301, 302, 300])
    assert.match(target.fullContent, /\[removed before this line\] export const line300 = 300/)
    assert.ok(target.contextProjection.includedBytes < target.contextProjection.originalBytes)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('diff projection marks actual additions only and preserves deletion evidence', async () => {
  const adapter = {
    async diff() {
      return {
        headRevision: 'head', complete: true,
        files: [{ path: 'policy.ts', status: 'modified', patch: '@@ -1,3 +1,3 @@\n keep\n-assertAuthorized(user)\n+logAccess(user)\n finish' }],
      }
    },
    async fileContent() { return { content: 'keep\nlogAccess(user)\nfinish', truncated: false } },
  }
  const [target] = await loadTargets({ kind: 'scm', adapter, ref: { repository: 'example/repo', id: '1' }, limits: { contextLines: 1 } })
  assert.deepEqual(target.changedRanges, [{ start: 2, end: 2 }])
  assert.match(target.fullContent, /\[removed before this line\] assertAuthorized\(user\)/)
  assert.deepEqual(target.contextProjection.includedRanges, [{ start: 1, end: 3 }])
  assert.equal(target.contextProjection.adjacentLines, 1)
  assert.equal(target.contextProjection.requestedAdjacentLines, 1)
})

test('deletion-only hunks remain reviewable at a current-source anchor', async () => {
  const adapter = {
    async diff() {
      return {
        headRevision: 'head', complete: true,
        files: [{ path: 'policy.ts', status: 'modified', patch: '@@ -1,2 +1 @@\n-assertAuthorized(user)\n keep' }],
      }
    },
    async fileContent() { return { content: 'keep', truncated: false } },
  }
  const [target] = await loadTargets({ kind: 'scm', adapter, ref: { repository: 'example/repo', id: '1' } })
  assert.equal(target.reviewStatus, undefined)
  assert.deepEqual(target.changedRanges, [{ start: 1, end: 1 }])
  assert.match(target.fullContent, /\[removed before this line\] assertAuthorized\(user\)/)
})

test('related source and test files share one bounded, auditable context pack', async () => {
  const cwd = repo({
    'widget.ts': 'export function widget() { return 1 }\n',
    'widget.test.ts': "import { widget } from './widget.js'\nwidget()\n",
  })
  try {
    const agent = createCodeReviewAgent({
      source: { kind: 'paths', cwd, paths: ['widget.ts', 'widget.test.ts'] },
      context: { maxRelatedFiles: 1 },
      reporters: [],
    })
    const plan = await agent.plan()
    assert.equal(plan.contextPacks.length, 1)
    assert.deepEqual(plan.contextPacks[0].files.sort(), ['widget.test.ts', 'widget.ts'])
    assert.equal(plan.contextPacks[0].expansion.length, 2)
    assert.ok(plan.contextPacks[0].estimatedTokens > 0)
    assert.ok(plan.contextPacks[0].estimatedTokens <= plan.contextPacks[0].tokenBudget)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('same basenames in unrelated directories do not consume related-file slots', async () => {
  const cwd = repo({ 'a/index.ts': 'export const a = 1\n', 'b/index.ts': 'export const b = 2\n' })
  try {
    const plan = await createCodeReviewAgent({
      source: { kind: 'paths', cwd, paths: ['a/index.ts', 'b/index.ts'] },
      context: { maxRelatedFiles: 1 },
      reporters: [],
    }).plan()
    assert.equal(plan.contextPacks.length, 2)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('provider prompt contains numbered source once and does not duplicate the unified patch', async () => {
  const cwd = repo({ 'sample.ts': 'export const answer = 1\n' })
  const capture = join(cwd, 'prompt.txt')
  const previous = { path: process.env.PATH, capture: process.env.CODEX_FIXTURE_CAPTURE_PROMPT }
  try {
    writeFileSync(join(cwd, 'sample.ts'), 'export const answer = 42\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-qm', 'change answer')
    process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
    process.env.CODEX_FIXTURE_CAPTURE_PROMPT = capture
    const result = await createCodeReviewAgent({
      adapter: codexCli(),
      source: { kind: 'git-diff', base: 'HEAD~1', head: 'HEAD', cwd },
      auditVotes: 1,
      consolidate: false,
      reporters: [],
    }).run()
    const prompt = readFileSync(capture, 'utf8')
    assert.equal(result.execution.attempted, 1)
    assert.equal(prompt.match(/export const answer = 42/g)?.length, 1)
    assert.doesNotMatch(prompt, /diff --git|^@@|PATCH —/m)
  } finally {
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path
    if (previous.capture === undefined) delete process.env.CODEX_FIXTURE_CAPTURE_PROMPT; else process.env.CODEX_FIXTURE_CAPTURE_PROMPT = previous.capture
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('AgentsKit token budgeting rejects an oversized pack before provider execution', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentskit-context-budget-'))
  const countFile = join(cwd, 'calls.txt')
  const previous = { path: process.env.PATH, count: process.env.CODEX_FIXTURE_COUNT_FILE }
  try {
    process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
    process.env.CODEX_FIXTURE_COUNT_FILE = countFile
    const agent = createCodeReviewAgent({
      adapter: codexCli(),
      source: { kind: 'stdin', filename: 'large.ts', content: 'export const value = "' + 'x'.repeat(30_000) + '"', limits: { maxFileBytes: 40_000 } },
      context: { maxTokens: 1_000, reserveForOutput: 100 },
      reporters: [],
    })
    await assert.rejects(agent.run(), ReviewPreflightError)
    assert.throws(() => readFileSync(countFile, 'utf8'), /ENOENT/)
    const plan = await agent.plan()
    assert.equal(plan.contextPacks.length, 1)
    assert.match(plan.overBudget[0], /pack-1 needs .* tokens/)
  } finally {
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path
    if (previous.count === undefined) delete process.env.CODEX_FIXTURE_COUNT_FILE; else process.env.CODEX_FIXTURE_COUNT_FILE = previous.count
    rmSync(cwd, { recursive: true, force: true })
  }
})
