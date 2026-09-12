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
import { planReviewBatches } from '../dist/src/batch-mode.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const fixtureBin = join(root, 'test/fixtures/bin')

test('unchanged linked CSS reaches analysis and skeptic without inflating diff coverage', async () => {
  const calls = []
  const contents = {
    'ui/index.html': '<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="tour.css"><link rel="stylesheet" href="https://evil.test/remote.css"><link rel="stylesheet" href="../../../secret.css">',
    'ui/tour.css': '.tour-glow { animation: pulse 1s infinite }',
    'ui/base.css': '@media(prefers-reduced-motion:reduce){*{animation:none!important}}',
  }
  const adapter = {
    async diff() { return { headRevision: 'immutable-head', complete: true, files: ['ui/index.html', 'ui/tour.css'].map(path => ({ path, status: 'added', patch: '@@ -0,0 +1 @@\n+' + contents[path] })) } },
    async fileContent(ref, file, sha) { calls.push([file, sha]); return { content: contents[file], truncated: false } },
  }
  const prompts = []
  const inference = { createSource(request) { return { async *stream() {
    const prompt = request.messages.map(message => message.content).join('\n')
    const tool = request.context.tools[0]
    prompts.push({ name: tool.name, prompt })
    const args = tool.name === 'submit_verdicts'
      ? { verdicts: [{ id: 0, analysis: 'Global stylesheet disables motion, so the flagged finding does not hold.', refuted: prompt.includes('animation:none!important') }] }
      : { completedCategories: ['correctness', 'security', 'tests'], analysis: ['Checked the context pack for correctness, security, and test coverage.'], findings: prompt.includes('FILE: ui/tour.css') ? [{ file: 'ui/tour.css', line: 1, endLine: null, severity: 'med', category: 'correctness', confidence: .99, title: 'Motion is not disabled', rationale: 'Pulse is animated.', suggestion: 'Disable motion.', suggestedPatch: null }] : [] }
    yield { type: 'tool_call', toolCall: { id: 't', name: tool.name, args: JSON.stringify(args) } }
    yield { type: 'done' }
  } } } }
  const agent = createCodeReviewAgent({ source: { kind: 'scm', adapter, ref: { repository: 'org/repo', id: '1' } }, adapter: inference, reporters: [], consolidate: false })
  const plan = await agent.plan()
  assert.deepEqual(plan.reviewableFiles.sort(), ['ui/index.html', 'ui/tour.css'])
  const result = await agent.run(['ui/tour.css'])
  assert.deepEqual(calls, [['ui/index.html', 'immutable-head'], ['ui/tour.css', 'immutable-head'], ['ui/base.css', 'immutable-head']])
  assert.ok(prompts.some(item => item.name === 'submit_verdicts'))
  assert.ok(prompts.every(item => item.prompt.includes('animation:none!important')))
  assert.equal(result.findings.length, 0)
})

test('unavailable supporting CSS is explicit uncertainty, not fabricated complete context', async () => {
  const source = { kind: 'scm', ref: { repository: 'org/repo', id: '1' }, adapter: {
    async diff() { return { headRevision: 'head', complete: true, files: [{ path: 'index.html', status: 'added' }] } },
    async fileContent(ref, path) { return path === 'index.html' ? { content: '<link rel="stylesheet" href="base.css">', truncated: false } : { content: 'incomplete', truncated: true } },
  } }
  const [target] = await loadTargets(source)
  assert.equal(target.supportingSources[0].file, 'base.css')
  assert.equal(target.supportingSources[0].fullContent, '')
  assert.match(target.supportingSources[0].unavailableReason, /truncated/)
})

test('measured single-file batches reuse source and execute the exact selected packs', async () => {
  let reads = 0
  const content = Array.from({ length: 1800 }, (_, i) => `export const item${i} = '${'value '.repeat(10)}'`).join('\n')
  const adapter = {
    async diff() { return { headRevision: 'head', complete: true, files: [{ path: 'large.ts', status: 'added', patch: `@@ -0,0 +1,1800 @@\n${content.split('\n').map(line => `+${line}`).join('\n')}` }] } },
    async fileContent() { reads++; return { content, truncated: false } },
  }
  const agent = createCodeReviewAgent({ source: { kind: 'scm', adapter, ref: { repository: 'org/repo', id: '1' }, limits: { maxFileBytes: 1_000_000 } }, reporters: [], budget: { maxTokens: 40_000 } })
  const full = await agent.plan()
  const batches = await planReviewBatches(full.reviewableFiles, 5, (files, packs) => agent.plan(files, packs))
  assert.equal(reads, 1)
  assert.deepEqual(batches.overBudget, [])
  assert.ok(batches.batches.length > 1)
  const ids = batches.batches.flatMap(batch => batch.packIds)
  assert.deepEqual(ids, full.contextPacks.map(pack => pack.id))
  assert.equal(new Set(ids).size, ids.length)
  const selected = batches.batches[0]
  const plan = await agent.plan(selected.files, selected.packIds)
  assert.deepEqual(plan.contextPacks.map(pack => pack.id), selected.packIds)
  assert.ok(plan.estimatedAnalysisTokens <= plan.analysisTokenBudget)
})

test('patch files are reviewable text without treating patch instructions as commands', async () => {
  const targets = await loadTargets({ kind: 'scm', ref: { repository: 'org/repo', id: '1' }, adapter: {
    async diff() { return { headRevision: 'head', complete: true, files: [{ path: 'patches/dependency.patch', status: 'added' }] } },
    async fileContent() { return { content: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new', truncated: false } },
  } })
  assert.equal(targets.length, 1)
  assert.notEqual(targets[0].reviewStatus, 'UNREVIEWED')
})

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
    assert.match(plan.overBudget[0], /pack-1(?:\.\d+)? needs .* tokens/)
  } finally {
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path
    if (previous.count === undefined) delete process.env.CODEX_FIXTURE_COUNT_FILE; else process.env.CODEX_FIXTURE_COUNT_FILE = previous.count
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('oversized multi-line files split into complete bounded context packs', async () => {
  const cwd = repo({ 'large.ts': Array.from({ length: 800 }, (_, index) => `export const line${index + 1} = ${index + 1}`).join('\n') })
  try {
    const plan = await createCodeReviewAgent({
      source: { kind: 'paths', cwd, paths: ['large.ts'] },
      context: { adjacentLines: 0, maxTokens: 4_000, reserveForOutput: 500 },
      reporters: [],
    }).plan()
    assert.ok(plan.contextPacks.length > 1)
    assert.equal(plan.overBudget.length, 0)
    assert.ok(plan.contextPacks.every((pack) => pack.estimatedTokens <= pack.tokenBudget))
    const ranges = plan.contextPacks.flatMap((pack) => pack.expansion.flatMap((item) => item.includedRanges)).sort((a, b) => a.start - b.start)
    assert.equal(ranges[0].start, 1)
    assert.equal(ranges.at(-1).end, 800)
    assert.ok(ranges.every((range, index) => index === 0 || range.start <= ranges[index - 1].end + 1))
    assert.equal(plan.contextPacks.flatMap((pack) => pack.files).every((file) => file === 'large.ts'), true)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('large projections leave provider overhead margin before execution', async () => {
  const cwd = repo({ 'generated.api.md': Array.from({ length: 1_200 }, (_, index) => `export const line${index + 1} = '${'x'.repeat(150)}'`).join('\n') })
  try {
    const plan = await createCodeReviewAgent({
      source: { kind: 'paths', cwd, paths: ['generated.api.md'] },
      budget: { maxTokens: 250_000 },
      context: { adjacentLines: 0, maxTokens: 16_000, reserveForOutput: 2_000 },
      reporters: [],
    }).plan()
    assert.ok(plan.contextPacks.length > 1)
    assert.equal(plan.overBudget.length, 0)
    assert.ok(plan.contextPacks.every((pack) => pack.estimatedTokens <= pack.tokenBudget - 4_000))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
