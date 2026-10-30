import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (cwd, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
}

test('the shadow wrapper prints the comment JSON as its last stdout line and exits 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'shadow-review-'))
  try {
    git(home, 'init', '-q', '-b', 'main')
    git(home, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(home, 'checkout', '-q', '-b', 'feature')
    copyFileSync(join(root, 'test/fixtures/review/good.ts'), join(home, 'good.ts'))
    git(home, 'add', '.')
    git(home, 'commit', '-q', '-m', 'change')
    const run = spawnSync(process.execPath, [join(root, 'scripts/shadow-review.mjs')], {
      cwd: home, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, HOME: home, AGENTSKIT_SHADOW_BASE: 'main', AGENTSKIT_SHADOW_PROVIDER: 'codex-cli', AGENTSKIT_SHADOW_USD_PER_MTOK: '5', PATH: `${join(root, 'test/fixtures/bin')}:${process.env.PATH ?? ''}` },
    })
    assert.equal(run.status, 0, run.stderr)
    const last = JSON.parse(run.stdout.trimEnd().split('\n').at(-1))
    assert.match(last.comment, /^## Code review/)
    assert.equal(typeof last.costUsd, 'number')
    assert.ok(Array.isArray(last.findings))
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('the shadow wrapper reports no changed files without calling a provider', () => {
  const home = mkdtempSync(join(tmpdir(), 'shadow-review-'))
  try {
    git(home, 'init', '-q', '-b', 'main')
    git(home, 'commit', '-q', '--allow-empty', '-m', 'base')
    const run = spawnSync(process.execPath, [join(root, 'scripts/shadow-review.mjs')], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home, AGENTSKIT_SHADOW_BASE: 'main' } })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout.trimEnd().split('\n').at(-1)).findings, [])
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('the shadow wrapper rejects a malformed PR reference', () => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/shadow-review.mjs'), 'not a repo', 'x'], { encoding: 'utf8' })
  assert.equal(run.status, 2)
})
