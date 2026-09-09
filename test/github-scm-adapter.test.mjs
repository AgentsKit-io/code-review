import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubScmAdapter } from '../dist/src/github-scm-adapter.js'

const pull = {
  title: 'Adapter migration', state: 'open', draft: false, updated_at: '2026-09-09T00:00:00.000Z', user: { login: 'teammate' }, labels: [{ name: 'team' }],
  head: { sha: 'abcdef1234567', ref: 'feature', repo: { full_name: 'org/repo' } },
  base: { sha: '1234567abcdef', ref: 'main', repo: { full_name: 'org/repo' } },
  mergeable: true, mergeable_state: 'clean',
}

test('GitHub SCM adapter publishes and revision-locks merge through a fake HTTP boundary', async () => {
  const calls = []
  const fakeFetch = async (url, init = {}) => {
    const parsed = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ method, path: `${parsed.pathname}${parsed.search}`, body: init.body ? JSON.parse(init.body) : undefined })
    if (parsed.pathname.endsWith('/pulls/7') && method === 'GET') return Response.json(pull)
    if (parsed.pathname.endsWith('/pulls/7/files')) return Response.json([{ filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' }])
    if (parsed.pathname.endsWith('/contents/src%2Fa.ts')) return Response.json({ encoding: 'base64', content: Buffer.from('export const a = 2').toString('base64') })
    if (parsed.pathname.endsWith('/issues/7/comments') && method === 'GET') return Response.json([])
    if (parsed.pathname.endsWith('/pulls/7/reviews')) return Response.json({ id: 11, html_url: 'https://github.test/review/11' })
    if (parsed.pathname.endsWith('/issues/7/comments') && method === 'POST') return Response.json({ id: 12, html_url: 'https://github.test/comment/12' })
    if (parsed.pathname.endsWith('/commits/abcdef1234567/check-runs')) return Response.json({ total_count: 1, check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] })
    if (parsed.pathname.endsWith('/commits/abcdef1234567/status')) return Response.json({ state: 'success', total_count: 1, statuses: [{}] })
    if (parsed.pathname.endsWith('/pulls/7/merge') && method === 'PUT') return Response.json({ merged: true, sha: 'fedcba7654321' })
    throw new Error(`unexpected fake GitHub request: ${method} ${parsed.pathname}${parsed.search}`)
  }
  const scm = createGithubScmAdapter({ token: 'secret', fetch: fakeFetch })
  const ref = { repository: 'org/repo', id: '7' }
  const metadata = await scm.metadata(ref)
  const diff = await scm.diff(ref)
  const content = await scm.fileContent(ref, diff.files[0].path, diff.headRevision, 1_024)
  const state = await scm.reviewState(ref, 'policy-v1')
  await scm.publishReview(ref, { channel: 'review', headRevision: state.headRevision, fingerprint: state.fingerprint, verdict: 'APPROVE', summary: 'Clean.', annotations: [{ path: 'src/a.ts', line: 1, body: 'Verified.' }] })
  await scm.publishReview(ref, { channel: 'summary', headRevision: state.headRevision, fingerprint: state.fingerprint, verdict: 'APPROVE', summary: 'Walkthrough.', annotations: [] })
  const readiness = await scm.mergeReadiness(ref)
  const merged = await scm.merge(ref, { expectedHeadRevision: readiness.headRevision, method: 'squash', admin: false })

  assert.equal(metadata.author, 'teammate')
  assert.equal(content.content, 'export const a = 2')
  assert.equal(state.alreadyPublished, false)
  assert.equal(readiness.ready, true)
  assert.equal(merged.revision, 'fedcba7654321')
  const mergeCall = calls.find((call) => call.path.endsWith('/pulls/7/merge'))
  assert.deepEqual(mergeCall.body, { sha: 'abcdef1234567', merge_method: 'squash' })
  assert.equal(calls.filter((call) => call.path.endsWith('/pulls/7/reviews')).length, 1)
  assert.equal(calls.filter((call) => call.path.endsWith('/issues/7/comments') && call.method === 'POST').length, 1)
})

test('administrative merge stays behind an injectable command boundary', async () => {
  const commands = []
  const scm = createGithubScmAdapter({ token: 'secret', fetch: async () => { throw new Error('network forbidden') }, command: async (command, args) => { commands.push([command, ...args]); return {} } })
  await scm.merge({ repository: 'org/repo', id: '7' }, { expectedHeadRevision: 'abcdef1', method: 'squash', admin: true })
  assert.deepEqual(commands, [['gh', 'pr', 'merge', '7', '-R', 'org/repo', '--squash', '--admin', '--match-head-commit', 'abcdef1']])
})
