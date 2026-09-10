import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  assert.match(version, /gh workflow run "\$workflow" --ref changeset-release\/main/)
  assert.doesNotMatch(version, /gh pr (?:close|reopen|merge)/)
  for (const name of ['ci', 'codeql', 'dependency-review']) assert.match(read(`.github/workflows/${name}.yml`), /workflow_dispatch:/)
  assert.match(read('.github/workflows/dependency-review.yml'), /base-ref:.*'main'/)
  assert.match(read('.github/workflows/dependency-review.yml'), /head-ref:.*github.sha/)
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
  assert.match(packageJson.scripts['version-packages'], /changeset version && npm run docs:full && npm run readme:standard:refresh/)
})
