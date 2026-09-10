import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CampaignPreflightReportSchema, preflightCampaign } from '../dist/src/campaign-preflight.js'
import { CampaignExecutionReportSchema } from '../dist/src/campaign-runner.js'
import { defineConfig, toReviewConfig } from '../dist/src/public-config.js'
import { resolveReviewConfig } from '../dist/src/review-config.js'
import { reviewPolicyFingerprint } from '../dist/src/review-policy.js'

const sha = (digit) => digit.repeat(40)
const capabilities = Object.fromEntries(['discovery', 'metadata', 'diff', 'file-content', 'review-state', 'publish-review', 'merge-readiness', 'merge'].map((key) => [key, true]))
const ref = (id) => ({ repository: 'AgentsKit-io/example', id: String(id) })

function fakeScm(observedFingerprints = []) {
  const authors = { 1: 'alice', 2: 'dependabot[bot]', 3: 'carol', 4: 'bob', 5: 'bob', 6: 'bob' }
  return {
    id: 'github', capabilities,
    async discover() { return [ref(6), ref(4), ref(1), ref(3), ref(2), ref(5)] },
    async metadata(change) {
      return { ref: change, title: `PR ${change.id}`, state: 'open', author: authors[change.id], sourceRevision: sha(change.id), targetRevision: sha('a'), sourceBranch: `branch-${change.id}`, targetBranch: 'main', isDraft: change.id === '5', isFork: false, labels: [], updatedAt: '2026-09-09T00:00:00.000Z' }
    },
    async reviewState(change, fingerprint) { observedFingerprints.push(fingerprint); return { headRevision: sha(change.id), fingerprint, alreadyPublished: change.id === '4', scope: 'full', baselineRevision: null } },
    async diff(change) { return { baseRevision: sha('a'), headRevision: sha(change.id), complete: true, files: [{ path: change.id === '6' ? 'removed.ts' : `src/${change.id}.ts`, status: change.id === '6' ? 'removed' : 'modified', patch: '@@ -1 +1 @@\n-old\n+new', truncated: false }] } },
    async fileContent(change, path) { return { content: change.id === '1' ? 'export const key = `tenant\0workspace`\n' : `export const file = '${path}'\n`, truncated: false } },
    async publishReview() { throw new Error('preflight must not publish') },
    async mergeReadiness() { throw new Error('preflight must not inspect merge readiness') },
    async merge() { throw new Error('preflight must not merge') },
  }
}

test('campaign skips a completed worker review regardless of execution concurrency', async () => {
  const config = defineConfig({ target: { provider: 'github', repository: 'AgentsKit-io/example', authors: ['alice'] }, review: { provider: 'codex-cli', maxCalls: 1000 } })
  const file = toReviewConfig(config)
  const workerPolicy = reviewPolicyFingerprint(resolveReviewConfig(file, { overrides: { profile: 'full', concurrency: 8 } }))
  const adapter = fakeScm()
  adapter.discover = async () => [ref(1)]
  adapter.reviewState = async (_ref, fingerprint) => ({ headRevision: sha('1'), fingerprint, alreadyPublished: fingerprint === workerPolicy, scope: 'full', baselineRevision: null })
  adapter.diff = async () => { throw new Error('an already reviewed PR must not load its diff') }
  const report = await preflightCampaign({ config, adapter, providerHealth })
  assert.equal(report.pullRequests[0].status, 'skipped')
  assert.equal(report.pullRequests[0].worktreeAllowed, false)
  assert.match(report.pullRequests[0].reasons.join(' '), /already reviewed/)
  assert.notEqual(workerPolicy, reviewPolicyFingerprint(resolveReviewConfig(file, { overrides: { minSeverity: 'high' } })), 'semantic policy changes still invalidate review identity')
})

const providerHealth = { ok: true, provider: 'codex-cli', checks: [{ name: 'executable', status: 'pass', detail: 'codex' }] }

test('batched policy identity retains optional lenses, thresholds and publication/check policy', () => {
  const file = toReviewConfig(defineConfig({ target: { repository: 'org/repo' }, review: {}, batches: { enabled: true } }))
  const fingerprint = value => reviewPolicyFingerprint(resolveReviewConfig(value))
  const baseline = fingerprint(file)
  for (const modified of [
    { ...file, lenses: { ...file.lenses, performance: { enabled: false, required: false } } },
    { ...file, thresholds: { ...file.thresholds, maxPerFile: 2 } },
    { ...file, comments: { ...file.comments, summary: false } },
    { ...file, checks: { mode: 'disabled' } },
  ]) assert.notEqual(fingerprint(modified), baseline)
})

test('campaign preflight classifies every discovered PR and permits worktrees only for ready entries', async () => {
  const config = defineConfig({
    target: { provider: 'github', repository: 'AgentsKit-io/example', authors: ['alice', 'bob', 'carol'], excludeAuthors: ['carol'] },
    review: { provider: 'codex-cli' },
  })
  const fingerprints = []
  const report = await preflightCampaign({ config, adapter: fakeScm(fingerprints), providerHealth, now: () => new Date('2026-09-09T00:00:00.000Z') })
  assert.deepEqual(report.pullRequests.map((pull) => pull.ref.id), ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(report.pullRequests.map((pull) => pull.status), ['ready', 'skipped', 'skipped', 'skipped', 'skipped', 'blocked'])
  assert.deepEqual(report.pullRequests.filter((pull) => pull.worktreeAllowed).map((pull) => pull.ref.id), ['1'])
  assert.match(report.pullRequests[1].reasons.join(' '), /Dependabot/)
  assert.match(report.pullRequests[2].reasons.join(' '), /explicitly excluded/)
  assert.match(report.pullRequests[3].reasons.join(' '), /already reviewed/)
  assert.match(report.pullRequests[5].reasons.join(' '), /unreviewed/)
  assert.deepEqual(report.pullRequests[0].plan.changedFiles, ['src/1.ts'])
  assert.deepEqual(report.pullRequests[0].plan.reviewableFiles, ['src/1.ts'])
  assert.ok(fingerprints.every((fingerprint) => fingerprint === reviewPolicyFingerprint(resolveReviewConfig(toReviewConfig(config)))))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.worktreesCreated, 0)
  assert.equal(report.status, 'blocked')
})

test('provider failure blocks the campaign without hiding discoverable PR outcomes', async () => {
  const config = defineConfig({ target: { provider: 'github', repository: 'AgentsKit-io/example', authors: ['alice'] }, review: {} })
  const report = await preflightCampaign({ config, adapter: fakeScm(), providerHealth: { ok: false, provider: 'codex-cli', checks: [{ name: 'executable', status: 'fail', detail: 'missing' }] } })
  assert.equal(report.status, 'blocked')
  assert.equal(report.checks.find((check) => check.id === 'provider.health').ok, false)
  assert.equal(report.pullRequests.length, 6)
  assert.equal(report.pullRequests.some((pull) => pull.worktreeAllowed), false)
})

test('preflight keeps per-file failures and changed-head races visible', async () => {
  const adapter = fakeScm()
  adapter.discover = async () => [ref(7)]
  adapter.metadata = async (change) => ({ ref: change, title: 'PR 7', state: 'open', author: 'bob', sourceRevision: sha('7'), targetRevision: sha('a'), sourceBranch: 'branch-7', targetBranch: 'main', isDraft: false, isFork: false, labels: [], updatedAt: '2026-09-09T00:00:00.000Z' })
  adapter.reviewState = async (_change, fingerprint) => ({ headRevision: sha('8'), fingerprint, alreadyPublished: true, scope: 'full', baselineRevision: null })
  adapter.diff = async () => ({ baseRevision: sha('a'), headRevision: sha('7'), complete: true, files: [{ path: 'src/bad.ts', status: 'modified', patch: '@@ -1 +1 @@', truncated: false }, { path: 'src/good.ts', status: 'modified', patch: '@@ -1 +1 @@', truncated: false }] })
  adapter.fileContent = async (_change, path) => { if (path.endsWith('bad.ts')) throw new Error('fixture unavailable'); return { content: 'export const ok = true\n', truncated: false } }
  const config = defineConfig({ target: { provider: 'github', repository: 'AgentsKit-io/example', authors: ['bob'] }, review: {}, batches: { requireCompleteCoverage: false, failOnUnreviewableFiles: true } })
  const report = await preflightCampaign({ config, adapter, providerHealth })
  assert.equal(report.pullRequests[0].status, 'blocked')
  assert.match(report.pullRequests[0].reasons.join(' '), /head revision changed/)
  assert.deepEqual(report.pullRequests[0].plan.changedFiles, ['src/bad.ts', 'src/good.ts'])
  assert.deepEqual(report.pullRequests[0].plan.reviewableFiles, ['src/good.ts'])
  assert.match(report.pullRequests[0].plan.unreviewed[0].reason, /fixture unavailable/)
})

test('preflight checks every batch instead of suppressing impossible budgets', async () => {
  const adapter = fakeScm()
  adapter.discover = async () => [ref(1)]
  adapter.diff = async () => ({ baseRevision: sha('a'), headRevision: sha('1'), complete: true, files: Array.from({ length: 20 }, (_, index) => ({ path: `src/${index}.ts`, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', truncated: false })) })
  adapter.fileContent = async (_change, path) => ({ content: `export const value = '${path}'\n`, truncated: false })
  const config = defineConfig({ target: { provider: 'github', repository: 'AgentsKit-io/example', authors: ['alice'] }, review: { maxCalls: 1 }, batches: { enabled: true, size: 1 } })
  const report = await preflightCampaign({ config, adapter, providerHealth })
  assert.equal(report.pullRequests[0].status, 'blocked')
  assert.match(report.pullRequests[0].reasons.join('; '), /batch .*estimated provider calls/)
})

test('packaged campaign command rejects invalid configuration before credentials or model work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-campaign-'))
  try {
    const config = join(directory, 'code-review.config.json')
    const output = join(directory, 'report.json')
    writeFileSync(config, JSON.stringify({ target: { repository: 'invalid' }, review: {} }))
    const run = spawnSync(process.execPath, ['scripts/review-campaign.mjs', '--config', config, '--output', output], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    assert.equal(run.status, 2, run.stderr)
    const report = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(report.status, 'blocked')
    assert.equal(report.modelCalls, 0)
    assert.equal(report.worktreesCreated, 0)
    assert.match(report.checks[0].detail, /invalid code-review config/)
    CampaignPreflightReportSchema.parse(report)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('packaged campaign command keeps stdout machine-readable when output cannot be written', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-campaign-output-'))
  try {
    const config = join(directory, 'invalid.json')
    writeFileSync(config, '{}')
    const run = spawnSync(process.execPath, ['scripts/review-campaign.mjs', '--config', config, '--output', '/dev/null/report.json'], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    assert.equal(run.status, 2)
    const report = CampaignPreflightReportSchema.parse(JSON.parse(run.stdout))
    assert.equal(report.checks.at(-1).id, 'output.write')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('packaged campaign command turns provider-free blockers into a terminal campaign report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-campaign-valid-'))
  try {
    const config = join(directory, 'code-review.config.json')
    const bin = join(directory, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nprintf "Logged in\n"\n', { mode: 0o755 })
    writeFileSync(config, JSON.stringify({ target: { repository: 'AgentsKit-io/example' }, review: { mode: 'trusted-local' }, execution: { statePath: 'state' } }))
    const run = spawnSync(process.execPath, ['scripts/review-campaign.mjs', '--config', config], { encoding: 'utf8', env: { PATH: bin } })
    assert.equal(run.status, 2, run.stderr)
    const report = CampaignExecutionReportSchema.parse(JSON.parse(run.stdout))
    assert.equal(report.outcome, 'BLOCKED')
    assert.deepEqual(report.pullRequests, [])
    const matrix = JSON.parse(readFileSync(join(directory, 'state', 'campaigns', report.campaignId, 'quality-matrix.json'), 'utf8'))
    assert.equal(existsSync(join(directory, 'state', 'campaigns', report.campaignId, 'quality-matrix.json')), true)
    assert.equal(matrix.evidence.kind, 'real-campaign')
    assert.equal(matrix.decision, 'BLOCKED')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('campaign mutations stay explicit and are forwarded to the single-PR worker', () => {
  const source = readFileSync('scripts/review-campaign.mjs', 'utf8')
  assert.match(source, /const automationId = value\('automation-id'\)/)
  assert.match(source, /write\(orcaEvidence, \{ version: 1, status: 'passed'/)
  assert.match(source, /'--orca-evidence', orcaEvidence/)
  assert.match(source, /const post = process\.argv\.includes\('--post'\)/)
  assert.match(source, /const merge = process\.argv\.includes\('--merge'\)/)
  assert.match(source, /const mode = value\('mode'\) \?\? 'isolated'/)
  assert.match(source, /'--mode', mode/)
  assert.match(source, /const campaignId = `campaign-\$\{hash\(JSON\.stringify\(\{ executionFingerprint, packageVersion: packageVersion\(\), preflight: stablePreflight \}\)\)\.slice\(0, 16\)\}`/)
  assert.match(source, /\.\.\.\(post \? \['--post'\] : \[\]\)/)
  assert.match(source, /\.\.\.\(merge \? \['--merge'\] : \[\]\)/)
  assert.match(source, /pullRequestLeaseTtlMs: Math\.min\(workerTimeoutMs \+ 60_000, 120_000\)/)
})
