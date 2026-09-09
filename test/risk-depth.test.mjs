import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'
import { classifyContextPack } from '../dist/agents/code-review/risk.js'
import { codexCli } from '../dist/src/codex-adapter.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const fixtureBin = join(root, 'test/fixtures/bin')
const target = (file, fullContent = 'const value = 1') => ({ file, fullContent, language: 'ts', isChanged: true })

test('risk classification is deterministic across low, normal, high, and critical evidence', () => {
  assert.equal(classifyContextPack([target('docs/guide.md')]).level, 'low')
  assert.equal(classifyContextPack([target('docs/security.md', '# Authentication')]).level, 'low')
  assert.equal(classifyContextPack([target('src/helper.ts')]).level, 'normal')
  assert.deepEqual(classifyContextPack([target('src/contracts/user.ts', 'export interface User { id: string }')]), {
    level: 'high',
    signals: [
      { kind: 'public-contract', file: 'src/contracts/user.ts', reason: 'public contract path or declaration format' },
    ],
    specializedCategories: ['correctness'],
  })
  assert.deepEqual(classifyContextPack([target('src/auth/session.ts', 'export function authorize(user) { return user.role }')]).specializedCategories, ['correctness', 'security'])
  assert.equal(classifyContextPack([target('migrations/001.sql')]).level, 'critical')
})

test('planning elevated depth is provider-free and includes its call budget', async () => {
  let providerCalls = 0
  const adapter = { createSource() { providerCalls += 1; throw new Error('provider must not run during planning') } }
  const plan = await createCodeReviewAgent({
    adapter,
    source: { kind: 'stdin', filename: 'src/auth/session.ts', content: 'export function authorize(user) { return user.role }' },
    reporters: [],
  }).plan()
  assert.equal(providerCalls, 0)
  assert.equal(plan.contextPacks[0].risk.level, 'critical')
  assert.deepEqual(plan.contextPacks[0].risk.specializedCategories, ['correctness', 'security'])
  assert.equal(plan.estimatedProviderCalls, 5)
})

test('low-risk documentation uses one analysis and records auditable risk evidence', async () => {
  const previous = process.env.PATH
  try {
    process.env.PATH = `${fixtureBin}:${previous ?? ''}`
    const result = await createCodeReviewAgent({ adapter: codexCli(), source: { kind: 'stdin', filename: 'docs/guide.md', content: '# Guide' }, reporters: [] }).run()
    assert.deepEqual(result.evidence.contextPacks?.[0].risk, {
      level: 'low', signals: [{ kind: 'documentation', file: 'docs/guide.md', reason: 'documentation path or format' }], specializedCategories: [],
    })
    assert.deepEqual(result.execution, { attempted: 1, succeeded: 1, failed: 0 })
    assert.equal(result.evidence.providerCalls, 1)
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous }
})

test('critical authorization code receives specialized review without losing seeded detection', async () => {
  const previous = { path: process.env.PATH, corpus: process.env.CODEX_FIXTURE_QUALITY_CORPUS }
  try {
    process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
    process.env.CODEX_FIXTURE_QUALITY_CORPUS = '1'
    const source = 'type Request = { headers: Record<string, string | undefined>; user?: { role: string } }\n\nexport function canDeleteAccount(request: Request, accountId: string): boolean {\n  const token = request.headers.authorization\n  if (!token) return false\n  return Boolean(accountId)\n}\n'
    const result = await createCodeReviewAgent({ adapter: codexCli(), source: { kind: 'stdin', filename: 'snippet.ts', content: source }, auditVotes: 1, consolidate: false, reporters: [] }).run()
    assert.equal(result.evidence.contextPacks?.[0].risk.level, 'critical')
    assert.deepEqual(result.evidence.contextPacks?.[0].risk.specializedCategories, ['correctness', 'security'])
    assert.deepEqual(result.execution, { attempted: 2, succeeded: 2, failed: 0 })
    assert.ok(result.findings.some((finding) => finding.category === 'security' && finding.severity === 'blocker'))
  } finally {
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path
    if (previous.corpus === undefined) delete process.env.CODEX_FIXTURE_QUALITY_CORPUS; else process.env.CODEX_FIXTURE_QUALITY_CORPUS = previous.corpus
  }
})

test('failed elevated analysis makes the review incomplete instead of clean', async () => {
  const previous = { path: process.env.PATH, fail: process.env.CODEX_FIXTURE_FAIL_SPECIALIZED }
  try {
    process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
    process.env.CODEX_FIXTURE_FAIL_SPECIALIZED = '1'
    const result = await createCodeReviewAgent({
      adapter: codexCli(),
      source: { kind: 'stdin', filename: 'src/auth/session.ts', content: 'export function authorize(user) { return user.role }' },
      reporters: [],
    }).run()
    assert.equal(result.incomplete, true)
    assert.equal(result.verdict, 'COMMENT')
    assert.deepEqual(result.execution, { attempted: 2, succeeded: 1, failed: 1 })
    assert.deepEqual(result.missingRequiredLenses, ['correctness', 'security'])
  } finally {
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path
    if (previous.fail === undefined) delete process.env.CODEX_FIXTURE_FAIL_SPECIALIZED; else process.env.CODEX_FIXTURE_FAIL_SPECIALIZED = previous.fail
  }
})
