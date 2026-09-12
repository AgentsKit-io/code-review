import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadRuleLayers, matchGlob, resolveRuleForFile, resolveRulesForFiles } from '../dist/src/review-rules.js'
import { SYSTEM_RULES } from '../dist/agents/code-review/rules.js'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'
import { codexCli } from '../dist/src/codex-adapter.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixtureBin = join(root, 'test/fixtures/bin')

test('matchGlob supports **, *, ?, and {a,b,c} alternation', () => {
  assert.ok(matchGlob('**/*.ts', 'src/foo.ts'))
  assert.ok(matchGlob('**/*.ts', 'foo.ts'))
  assert.ok(!matchGlob('**/*.ts', 'foo.tsx'))
  assert.ok(matchGlob('**/*.{ts,tsx}', 'src/deep/foo.tsx'))
  assert.ok(matchGlob('.github/workflows/*.{yml,yaml}', '.github/workflows/ci.yml'))
  assert.ok(!matchGlob('.github/workflows/*.{yml,yaml}', 'nested/.github/workflows/ci.yml'))
  assert.ok(matchGlob('file?.ts', 'file1.ts'))
  assert.ok(!matchGlob('file?.ts', 'file12.ts'))
  assert.ok(matchGlob('**', 'anything/at/all.rb'))
})

test('resolveRuleForFile falls back through project, global, then system, in precedence order', () => {
  const systemOnly = resolveRuleForFile('src/foo.ts', {})
  assert.equal(systemOnly.source, 'system')
  assert.match(systemOnly.rule, /TypeScript\/JavaScript checklist/)

  const withGlobal = resolveRuleForFile('src/foo.ts', { global: [{ path: '**/*.ts', rule: 'Global TS rule.' }] })
  assert.equal(withGlobal.source, 'global')
  assert.equal(withGlobal.mergedSystem, true)
  assert.match(withGlobal.rule, /Global TS rule\./)
  assert.match(withGlobal.rule, /TypeScript\/JavaScript checklist/)

  const withProject = resolveRuleForFile('src/foo.ts', {
    project: [{ path: '**/*.ts', rule: 'Project TS rule.' }],
    global: [{ path: '**/*.ts', rule: 'Global TS rule.' }],
  })
  assert.equal(withProject.source, 'project')
  assert.match(withProject.rule, /Project TS rule\./)
  assert.ok(!withProject.rule.includes('Global TS rule.'))

  const exclusive = resolveRuleForFile('src/foo.ts', { project: [{ path: '**/*.ts', rule: 'Only this.', mergeSystemRule: false }] })
  assert.equal(exclusive.mergedSystem, false)
  assert.equal(exclusive.rule, 'Only this.')
})

test('a file that matches no specific system glob falls back to the default catch-all', () => {
  const resolved = resolveRuleForFile('README.rb')
  assert.equal(resolved.source, 'system')
  assert.match(resolved.rule, /General checklist/)
})

test('resolveRulesForFiles deduplicates identical resolved rules across a pack', () => {
  const rules = resolveRulesForFiles(['a.ts', 'b.ts', 'c.py'])
  assert.equal(rules.length, 2)
  assert.ok(rules.some((rule) => rule.includes('TypeScript/JavaScript checklist')))
  assert.ok(rules.some((rule) => rule.includes('Python checklist')))
})

test('loadRuleLayers reads project and global rule files, and tolerates missing/malformed ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentskit-rules-'))
  try {
    mkdirSync(join(dir, '.agentskit-review'), { recursive: true })
    writeFileSync(join(dir, '.agentskit-review', 'rules.json'), JSON.stringify({ rules: [{ path: '**/*.tf', rule: 'Custom Terraform rule.' }] }))
    const layers = loadRuleLayers({ projectRoot: dir, globalRulesPath: join(dir, 'missing-global.json') })
    assert.deepEqual(layers.project, [{ path: '**/*.tf', rule: 'Custom Terraform rule.' }])
    assert.equal(layers.global, undefined)

    writeFileSync(join(dir, '.agentskit-review', 'rules.json'), '{not-json}')
    const malformed = loadRuleLayers({ projectRoot: dir, globalRulesPath: join(dir, 'missing-global.json') })
    assert.deepEqual(malformed.project, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rules are opt-in end to end: disabled by default, present in the real prompt once enabled', async () => {
  const capture = join(root, 'test/fixtures/review-rules-prompt.txt')
  const previous = { path: process.env.PATH, capture: process.env.CODEX_FIXTURE_CAPTURE_PROMPT }
  process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
  process.env.CODEX_FIXTURE_CAPTURE_PROMPT = capture
  try {
    const disabledAgent = createCodeReviewAgent({ adapter: codexCli(), source: { kind: 'stdin', filename: 'snippet.ts', content: 'export const x = 1\n' }, auditVotes: 1, consolidate: false, reporters: [] })
    await disabledAgent.run()
    assert.ok(!readFileSync(capture, 'utf8').includes('LANGUAGE/PATH REVIEW RULES'), 'rules must not appear in the prompt unless explicitly enabled')

    const enabledAgent = createCodeReviewAgent({ adapter: codexCli(), source: { kind: 'stdin', filename: 'snippet.ts', content: 'export const x = 1\n' }, auditVotes: 1, consolidate: false, reporters: [], rules: { enabled: true } })
    await enabledAgent.run()
    const prompt = readFileSync(capture, 'utf8')
    assert.match(prompt, /LANGUAGE\/PATH REVIEW RULES/)
    assert.match(prompt, /TypeScript\/JavaScript checklist/)
  } finally {
    try { unlinkSync(capture) } catch { /* best-effort cleanup */ }
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path
    if (previous.capture === undefined) delete process.env.CODEX_FIXTURE_CAPTURE_PROMPT; else process.env.CODEX_FIXTURE_CAPTURE_PROMPT = previous.capture
  }
})

test('system rule checklist covers the languages this issue targeted', () => {
  const languages = SYSTEM_RULES.map((entry) => entry.language)
  for (const expected of ['ts-js', 'python', 'go', 'rust', 'java', 'terraform', 'github-workflows', 'yaml', 'json', 'default']) {
    assert.ok(languages.includes(expected), `missing system rule for ${expected}`)
  }
  assert.equal(SYSTEM_RULES.at(-1).glob, '**', 'the catch-all default must be last so more specific globs are tried first')
})
