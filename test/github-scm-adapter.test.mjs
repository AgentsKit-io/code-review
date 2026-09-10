import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubScmAdapter } from '../dist/src/github-scm-adapter.js'

const pull = {
  title: 'Adapter migration', state: 'open', draft: false, updated_at: '2026-09-09T00:00:00.000Z', user: { login: 'teammate' }, labels: [{ name: 'team' }],
  head: { sha: 'abcdef1234567', ref: 'feature', repo: { full_name: 'org/repo' } },
  base: { sha: '1234567abcdef', ref: 'main', repo: { full_name: 'org/repo' } },
  mergeable: true, mergeable_state: 'clean',
}

test('transient file 404 retries once at the identical revision and persistent 404 fails', async () => {
  const urls = []
  const scm = createGithubScmAdapter({ token: 'fixture', fetch: async url => {
    urls.push(String(url))
    return urls.length === 1 ? Response.json({ message: 'Not Found' }, { status: 404 }) : Response.json({ encoding: 'base64', content: Buffer.from('source').toString('base64') })
  } })
  assert.equal((await scm.fileContent({ repository: 'org/repo', id: '7' }, 'src/a.ts', pull.head.sha, 100)).content, 'source')
  assert.equal(urls.length, 2)
  assert.equal(urls[0], urls[1])
  let calls = 0
  const unavailable = createGithubScmAdapter({ token: 'fixture', fetch: async () => { calls++; return Response.json({ message: 'Not Found' }, { status: 404 }) } })
  await assert.rejects(unavailable.fileContent({ repository: 'org/repo', id: '7' }, 'src/a.ts', pull.head.sha, 100), /404/)
  assert.equal(calls, 2)
})

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
    if (parsed.pathname.endsWith('/pulls/7/reviews') && method === 'GET') return Response.json([])
    if (parsed.pathname.endsWith('/pulls/7/reviews') && method === 'POST') return Response.json({ id: 11, html_url: 'https://github.test/review/11' })
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
  assert.deepEqual({ additions: metadata.additions, deletions: metadata.deletions }, { additions: 0, deletions: 0 })
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

test('check policy deterministically gates reported, required, named, and disabled modes', async () => {
  const readiness = async (policy, checkRuns) => {
    const fakeFetch = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/pulls/7')) return Response.json(pull)
      if (parsed.pathname.endsWith('/check-runs')) return Response.json({ total_count: checkRuns.length, check_runs: checkRuns })
      if (parsed.pathname.endsWith('/status')) return Response.json({ state: 'success', total_count: 0, statuses: [] })
      throw new Error(`unexpected fake GitHub request: ${parsed.pathname}`)
    }
    return createGithubScmAdapter({ token: 'secret', fetch: fakeFetch }).mergeReadiness({ repository: 'org/repo', id: '7' }, policy)
  }

  assert.equal((await readiness({ mode: 'reported' }, [])).ready, true)
  const required = await readiness({ mode: 'required' }, [])
  assert.equal(required.ready, false)
  assert.match(required.blockers.join('\n'), /no reported checks/)
  assert.equal((await readiness({ mode: 'named', names: ['ci'] }, [{ name: 'ci', status: 'completed', conclusion: 'success' }])).ready, true)
  const missing = await readiness({ mode: 'named', names: ['ci', 'lint'] }, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  assert.equal(missing.ready, false)
  assert.match(missing.blockers.join('\n'), /required check lint=missing/)
  const failed = await readiness({ mode: 'reported' }, [{ name: 'ci', status: 'completed', conclusion: 'failure' }])
  assert.equal(failed.ready, false)
  const disabled = await readiness({ mode: 'disabled' }, [])
  assert.equal(disabled.ready, false)
  assert.match(disabled.blockers.join('\n'), /check policy=disabled/)
})

test('review publication is idempotent across retries when a marker already exists', async () => {
  const marker = '<!-- agentskit-code-review:v1 sha=abcdef1234567 fingerprint=stable -->'
  const calls = []
  const fakeFetch = async (url, init = {}) => {
    const parsed = new URL(url)
    const method = init.method ?? 'GET'
    calls.push(`${method} ${parsed.pathname}`)
    if (parsed.pathname.endsWith('/pulls/7/reviews') && method === 'GET') return Response.json([{ id: 44, html_url: 'https://github.test/review/44', body: `${marker}\n## Code review — APPROVE` }])
    if (parsed.pathname.endsWith('/pulls/7/reviews') && method === 'POST') throw new Error('duplicate review must not be posted')
    throw new Error(`unexpected fake GitHub request: ${method} ${parsed.pathname}`)
  }
  const receipt = await createGithubScmAdapter({ token: 'secret', fetch: fakeFetch }).publishReview(
    { repository: 'org/repo', id: '7' },
    { channel: 'review', headRevision: 'abcdef1234567', fingerprint: 'stable', verdict: 'APPROVE', summary: 'Clean.', annotations: [] },
  )
  assert.deepEqual(receipt, { id: '44', url: 'https://github.test/review/44' })
  assert.deepEqual(calls, ['GET /repos/org/repo/pulls/7/reviews'])
})
