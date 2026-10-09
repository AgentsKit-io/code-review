import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTargets } from '../dist/agents/code-review/sources.js'

const ref = { repository: 'AgentsKit-io/example', id: '7' }
const head = 'b'.repeat(40)

const scm = (files, contents = {}) => loadTargets({
  kind: 'scm',
  ref,
  diff: { baseRevision: 'a'.repeat(40), headRevision: head, complete: true, files },
  adapter: {
    id: 'github',
    async diff() { throw new Error('diff is supplied') },
    async fileContent(_ref, path) {
      if (!(path in contents)) throw new Error(`a deleted file has no head content to download: ${path}`)
      return { content: contents[path], truncated: false }
    },
  },
})

test('a deleted file is reviewed from its patch, numbered by base-file line, and kept out of inline anchors', async () => {
  const patch = '@@ -1,3 +0,0 @@\n-export function guard(user) {\n-  return user.isAdmin\n-}'
  const [target] = await scm([{ path: 'src/guard.ts', status: 'removed', patch, truncated: false }])
  assert.equal(target.reviewStatus, undefined, 'a deletion with a patch is not UNREVIEWED')
  assert.equal(target.fullContent, '[deleted] export function guard(user) {\n[deleted]   return user.isAdmin\n[deleted] }')
  assert.deepEqual(target.sourceLineNumbers, [1, 2, 3])
  // GitHub anchors inline comments on the head side, where a deleted file has no lines.
  assert.deepEqual(target.changedRanges, [])
  assert.equal(target.isChanged, true)
  assert.equal(target.commitId, head)
})

test('a deleted file without a patch, or on a denied path, stays UNREVIEWED', async () => {
  const [noPatch, denied] = await scm([
    { path: 'assets/huge.ts', status: 'removed', truncated: false },
    { path: '.env', status: 'removed', patch: '@@ -1 +0,0 @@\n-SECRET=1', truncated: false },
  ])
  assert.equal(noPatch.reviewStatus, 'UNREVIEWED')
  assert.match(noPatch.unreviewedReason, /no patch/)
  assert.equal(denied.reviewStatus, 'UNREVIEWED')
  assert.equal(denied.fullContent, '', 'a denied deletion never carries its removed lines into the prompt')
})

test('a PR that deletes one file and edits another reviews both', async () => {
  const targets = await scm([
    { path: 'src/old.ts', status: 'removed', patch: '@@ -1 +0,0 @@\n-export const old = 1', truncated: false },
    { path: 'src/new.ts', status: 'modified', patch: '@@ -1 +1 @@\n-export const v = 1\n+export const v = 2', truncated: false },
  ], { 'src/new.ts': 'export const v = 2\n' })
  assert.deepEqual(targets.map((target) => [target.file, target.reviewStatus ?? 'REVIEWED']), [['src/old.ts', 'REVIEWED'], ['src/new.ts', 'REVIEWED']])
})
