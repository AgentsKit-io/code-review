import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { resolveReviewConfig, loadReviewConfig, ReviewConfigError } from '../dist/src/review-config.js'
import { configFingerprint, defineConfig, generateConfigSchema, loadProjectConfig, toReviewConfig, validateConfig } from '../dist/src/public-config.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function tempRepo(config) {
  const cwd = mkdtempSync(join(tmpdir(), 'agentskit-review-config-'))
  if (config !== undefined) writeFileSync(join(cwd, '.agentskit-review.json'), JSON.stringify(config))
  return cwd
}

test('defaults enable every lens and require correctness, security, and tests', () => {
  const config = resolveReviewConfig()
  assert.deepEqual(Object.fromEntries(Object.entries(config.lenses).map(([key, value]) => [key, value.enabled])), {
    correctness: true, security: true, performance: true, maintainability: true, design: true, tests: true, conventions: true,
  })
  assert.deepEqual(Object.entries(config.lenses).filter(([, value]) => value.required).map(([key]) => key), ['correctness', 'security', 'tests'])
  assert.deepEqual(config.context, { mode: 'prompt', patterns: [], adjacentLines: 40, maxRelatedFiles: 1, maxTokens: 16000, reserveForOutput: 2000 })
})

test('CLI overrides max findings per file without changing project config', () => {
  const config = resolveReviewConfig({ configVersion: 1, thresholds: { maxPerFile: 9 } }, { overrides: { maxPerFile: 2 } })
  assert.equal(config.thresholds.maxPerFile, 2)
})

test('explicit CLI trust mode reaches the resolved adapter configuration', () => {
  assert.equal(resolveReviewConfig({ configVersion: 1 }, { overrides: { trustMode: 'trusted-local' } }).trustMode, 'trusted-local')
  assert.throws(() => resolveReviewConfig({ configVersion: 1 }, { ci: true, overrides: { trustMode: 'trusted-local' } }), /forbidden in CI/)
  assert.throws(() => resolveReviewConfig({ configVersion: 1, trustMode: 'trusted-local' }), /explicit trusted CLI invocation/)
})

test('merges independent lens policy and flags override file values', () => {
  const config = resolveReviewConfig({
    configVersion: 1,
    lenses: { performance: { enabled: false, required: false } },
    votes: 3,
    thresholds: { minSeverity: 'high' },
  }, { overrides: { votes: 1, minSeverity: 'med' } })
  assert.equal(config.lenses.performance.enabled, false)
  assert.equal(config.lenses.security.enabled, true)
  assert.equal(config.votes, 1)
  assert.equal(config.thresholds.minSeverity, 'med')
  assert.equal(config.worker.timeoutMs, 120000)
  assert.equal(config.budget.maxCalls, 1000)
  assert.equal(resolveReviewConfig({ configVersion: 1, provider: 'codex-cli' }).budget.concurrency, 1)
  assert.equal(resolveReviewConfig({ configVersion: 1, provider: 'codex-cli' }).worker.timeoutMs, 300000)
  assert.equal(resolveReviewConfig({ configVersion: 1, provider: 'openai' }).budget.concurrency, 4)
})

test('project config exposes a bounded global campaign deadline', () => {
  const project = defineConfig({ target: { repository: 'AgentsKit-io/example' }, review: {} })
  assert.equal(project.review.globalDeadlineMs, 7_200_000)
  assert.throws(() => defineConfig({ target: { repository: 'AgentsKit-io/example' }, review: { globalDeadlineMs: 7_200_001 } }), /globalDeadlineMs/)
})

test('project config accepts an external quality baseline for real campaigns', () => {
  const project = defineConfig({ target: { repository: 'AgentsKit-io/example' }, review: { qualityBaseline: '/tmp/quality-baseline.json' } })
  assert.equal(project.review.qualityBaseline, '/tmp/quality-baseline.json')
})

test('fast profile disables optional lenses, batches, and uses bounded defaults', () => {
  const config = resolveReviewConfig({ configVersion: 1, profile: 'fast' })
  assert.equal(config.profile, 'fast')
  assert.equal(config.batchLenses, true)
  assert.deepEqual(Object.entries(config.lenses).filter(([, value]) => value.enabled).map(([key]) => key), ['correctness', 'security', 'tests'])
  assert.equal(config.votes, 1)
  assert.equal(config.retries, 0)
  assert.equal(config.thresholds.maxPerFile, 1)
  assert.equal(config.budget.deadlineMs, 120000)
  assert.equal(resolveReviewConfig(undefined, { overrides: { deadlineMs: 5000 } }).budget.deadlineMs, 5000)
})

test('rejects unknown fields, unsupported versions, and impossible required lenses', () => {
  for (const config of [
    { configVersion: 1, unknown: true },
    { configVersion: 2 },
    { configVersion: 1, lenses: { security: { enabled: false, required: true } } },
  ]) assert.throws(() => resolveReviewConfig(config), ReviewConfigError)
  assert.throws(() => resolveReviewConfig({ configVersion: 1, budget: { maxCalls: 1001 } }), ReviewConfigError)
  assert.throws(() => resolveReviewConfig({ configVersion: 1, context: { mode: 'prompt', maxTokens: 1000, reserveForOutput: 1000 } }), ReviewConfigError)
})

test('requires an explicit local exception for an incomplete profile and rejects it in CI', () => {
  const config = { configVersion: 1, incompleteProfile: true, lenses: { security: { enabled: false, required: true } } }
  assert.throws(() => resolveReviewConfig(config), /allow-incomplete/)
  assert.equal(resolveReviewConfig(config, { allowIncomplete: true }).incompleteProfile, true)
  assert.throws(() => resolveReviewConfig(config, { ci: true, allowIncomplete: true }), /local-only/)
})

test('CI cannot accept trusted execution inputs or secrets from the project file', () => {
  assert.throws(() => resolveReviewConfig({ configVersion: 1, provider: 'openai' }, { ci: true }), /provider/)
  assert.throws(() => resolveReviewConfig({ configVersion: 1, apiKey: 'secret-value' }), /apiKey/)
  assert.doesNotThrow(() => resolveReviewConfig({ configVersion: 1, context: { mode: 'prompt' } }))
  assert.doesNotThrow(() => resolveReviewConfig({ configVersion: 1, context: { mode: 'isolated-snapshot', patterns: ['src/**'] } }, { ci: true }))
  assert.throws(() => resolveReviewConfig({ configVersion: 1, context: { mode: 'isolated-snapshot', patterns: ['../**'] } }), /repository-relative/)
})

test('invalid config exits 2 before provider execution and does not echo secret values', () => {
  const cwd = tempRepo({ configVersion: 1, apiKey: 'never-echo-this-key' })
  try {
    const run = spawnSync(process.execPath, [join(root, 'dist/src/cli.js'), '--provider', 'codex-cli', '--stdin'], {
      cwd, input: 'export const answer = 42\n', encoding: 'utf8',
      env: { ...process.env, CI: '', PATH: '/usr/bin:/bin' },
    })
    assert.equal(run.status, 2, run.stdout)
    assert.match(run.stderr, /apiKey/)
    assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /never-echo-this-key/)
    assert.doesNotMatch(run.stdout, /Code review —/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('CLI applies project lens policy and flags override configuration', () => {
  const cwd = tempRepo({ configVersion: 1, lenses: { performance: { enabled: false, required: false } }, votes: 3 })
  const fixtureBin = join(root, 'test/fixtures/bin')
  try {
    const run = spawnSync(process.execPath, [join(root, 'dist/src/cli.js'), '--provider', 'codex-cli', '--stdin', '--votes', '1', '--no-fail'], {
      cwd, input: 'export const answer = 42\n', encoding: 'utf8',
      env: { ...process.env, CI: '', PATH: `${fixtureBin}:${process.env.PATH ?? ''}` },
    })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /1\/1 lens executions succeeded/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('an explicitly incomplete local profile never reports approval', () => {
  const cwd = tempRepo({ configVersion: 1, incompleteProfile: true, lenses: { security: { enabled: false, required: true } } })
  const fixtureBin = join(root, 'test/fixtures/bin')
  try {
    const run = spawnSync(process.execPath, [join(root, 'dist/src/cli.js'), '--provider', 'codex-cli', '--stdin', '--allow-incomplete'], {
      cwd, input: 'export const answer = 42\n', encoding: 'utf8',
      env: { ...process.env, CI: '', PATH: `${fixtureBin}:${process.env.PATH ?? ''}` },
    })
    assert.equal(run.status, 2, run.stderr)
    assert.match(run.stdout, /Code review — COMMENT/)
    assert.match(run.stdout, /not an approval/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('loadReviewConfig reads only the repository config filename', () => {
  const cwd = tempRepo({ configVersion: 1, votes: 2 })
  try { assert.equal(loadReviewConfig(cwd).votes, 2) } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('public config API provides presets, schema validation, and stable fingerprints', () => {
  const config = defineConfig({
    target: { repository: 'AgentsKit-io/agentskit-os' },
    review: { lenses: { security: true } },
  })
  assert.equal(config.target.provider, 'github')
  assert.equal(config.review.lenses.security, true)
  assert.equal(typeof configFingerprint(config), 'string')
  assert.equal((generateConfigSchema().$schema), 'http://json-schema.org/draft-07/schema#')
  assert.doesNotThrow(() => validateConfig(config))
  assert.throws(() => validateConfig({ target: { repository: 'not-a-repository' }, review: {} }), /owner\/repository/)
})

test('public batch policy is carried into the executable review config', () => {
  const config = defineConfig({
    target: { provider: 'github', repository: 'AgentsKit-io/agentskit-os' },
    review: {},
    batches: { enabled: true, size: 8, requireCompleteCoverage: true, failOnUnreviewableFiles: true },
  })
  const resolved = resolveReviewConfig(toReviewConfig(config))
  assert.deepEqual(resolved.batching, { enabled: true, size: 8, requireCompleteCoverage: true, failOnUnreviewableFiles: true })
  assert.equal(resolved.memory.enabled, true)
  assert.equal(resolved.memory.path, '.agentskit/review-memory')
  assert.equal(resolved.comments.language, 'en')
  assert.deepEqual(resolved.checks, { mode: 'required', names: [] })
})

test('public check policy is validated and carried into the executable config', () => {
  const config = defineConfig({
    target: { repository: 'AgentsKit-io/agentskit-os' },
    review: {},
    checks: { mode: 'named', names: ['CI', 'Security'] },
  })
  assert.deepEqual(config.checks, { mode: 'named', names: ['CI', 'Security'] })
  assert.deepEqual(resolveReviewConfig(toReviewConfig(config)).checks, config.checks)
  assert.throws(() => defineConfig({ target: { repository: 'AgentsKit-io/agentskit-os' }, review: {}, checks: { mode: 'named', names: [] } }), /at least one check name/)
  assert.throws(() => defineConfig({ target: { repository: 'AgentsKit-io/agentskit-os' }, review: {}, checks: { mode: 'required', names: ['CI'] } }), /only valid with the named policy/)
})

test('public config loader imports JavaScript and TypeScript config modules', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentskit-public-config-'))
  const modulePath = join(cwd, 'code-review.config.ts')
  writeFileSync(modulePath, `import { defineConfig } from ${JSON.stringify(resolve(root, 'dist/src/index.js'))}\nexport default defineConfig({ target: { repository: 'AgentsKit-io/agentskit-os' }, review: { provider: 'codex-cli' } })\n`)
  try {
    const loaded = await loadProjectConfig(cwd)
    assert.equal(loaded.config.target.repository, 'AgentsKit-io/agentskit-os')
    assert.equal(loaded.path, modulePath)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('CLI keeps review knowledge separate from provider conversations', () => {
  const cwd = tempRepo(undefined)
  const configPath = join(cwd, 'code-review.config.mjs')
  writeFileSync(configPath, `import { defineConfig } from ${JSON.stringify(join(root, 'dist/src/index.js'))}\nexport default defineConfig({ target: { repository: 'AgentsKit-io/agentskit-os' }, review: { provider: 'codex-cli' }, memory: { enabled: true, path: '.agentskit/review-memory/messages.json' }, batches: { enabled: false } })\n`)
  const fixtureBin = join(root, 'test/fixtures/bin')
  try {
    const run = spawnSync(process.execPath, [join(root, 'dist/src/cli.js'), '--config', configPath, '--provider', 'codex-cli', '--stdin', '--profile', 'fast', '--health-check', 'off', '--votes', '1', '--no-fail'], {
      cwd, input: 'export const answer = 42\n', encoding: 'utf8',
      env: { ...process.env, CI: '', PATH: `${fixtureBin}:${process.env.PATH ?? ''}` },
    })
    assert.equal(run.status, 0, run.stderr)
    const memoryPath = join(cwd, '.agentskit/review-memory/messages.json')
    assert.equal(existsSync(memoryPath), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
