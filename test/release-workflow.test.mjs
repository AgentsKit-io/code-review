import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(join(root, path), 'utf8')

test('release workflows publish versioned main commits with OIDC and remain idempotent', () => {
  const version = read('.github/workflows/release.yml')
  const publish = read('.github/workflows/publish.yml')

  assert.match(version, /push:\n    branches: \[main\]/)
  assert.match(version, /changesets\/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/)
  assert.match(version, /pull-requests: write/)
  assert.match(version, /actions: write/)
  assert.match(version, /id: changesets/)
  assert.match(version, /!pr.author.is_bot/)
  assert.match(version, /pr.author.login !== "app\/github-actions"/)
  assert.match(version, /head_sha="\$version_sha"/)
  assert.match(version, /actions\/runs\/\$run_id\/approve/)
  assert.match(version, /\.conclusion == "action_required"/)
  assert.match(version, /seq 1 12/)
  assert.match(version, /any\(\.pull_requests\[\]; \.number == \(\$pr \| tonumber\)\)/)
  assert.doesNotMatch(version, /gh pr (?:close|reopen|merge)/)
  assert.doesNotMatch(version, /gh workflow run/)
  assert.doesNotMatch(version, /id-token: write/)
  assert.match(publish, /pull_request:\n    branches: \[main\]\n    types: \[closed\]/)
  assert.doesNotMatch(publish, /github\.event_name == 'push'/)
  assert.match(publish, /github\.event\.pull_request\.merged == true/)
  assert.match(publish, /github\.event\.pull_request\.title == 'chore: version packages'/)
  assert.match(publish, /github\.event\.pull_request\.head\.ref == 'changeset-release\/main'/)
  assert.match(publish, /github\.event\.pull_request\.user\.login == 'github-actions\[bot\]'/)
  assert.match(publish, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(publish, /id-token: write/)
  assert.match(publish, /npm run check/)
  assert.match(publish, /npm pack --dry-run/)
  assert.match(publish, /npm publish --access public/)
  assert.match(publish, /gh release create/)
  assert.doesNotMatch(publish, /workflow_dispatch|NPM_TOKEN|RECOVERY_VERSION|codex\/release-0\.4\.1/)
  assert.doesNotMatch(publish, /node -p \\\"/)
})

test('Changesets versioning refreshes generated documentation before release gates', () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.match(packageJson.scripts['version-packages'], /changeset version && npm version --no-git-tag-version --ignore-scripts --allow-same-version/)
  assert.match(packageJson.scripts['version-packages'], /npm run docs:full && npm run readme:standard:refresh/)
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, packageJson.version)
  assert.equal(lock.packages[''].version, packageJson.version)
})

test('release step requires server-confirmed immutability for new and existing releases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-release-'))
  const script = read('.github/workflows/publish.yml').split('      - name: Create the immutable GitHub release')[1].split('        run: |\n')[1].replace(/^          /gm, '')
  try {
    writeFileSync(join(directory, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'release' && args[1] === 'view') process.exit(Number(process.env.FIXTURE_EXISTS) ? 0 : 1)
if (args[0] === 'release' && args[1] === 'create') process.exit(0)
if (args[0] === 'api' && args[1].includes('/releases/tags/') && args.at(-1) === '.immutable') {
  process.stdout.write(process.env.FIXTURE_IMMUTABLE + '\\n'); process.exit(0)
}
process.exit(2)
`, { mode: 0o700 })
    for (const exists of ['0', '1']) for (const immutable of ['true', 'false']) {
      const result = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_REPOSITORY: 'example/release', FIXTURE_EXISTS: exists, FIXTURE_IMMUTABLE: immutable } })
      assert.equal(result.status, immutable === 'true' ? 0 : 1, result.stderr)
      if (immutable === 'false') assert.match(result.stderr, /not immutable/)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
