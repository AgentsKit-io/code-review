import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createGithubScmAdapter } from '../dist/src/github-scm-adapter.js'
import { GithubResponseLimitError, githubFetch, githubGet, readGithubResponseText } from '../dist/src/github-review-state.js'

const pull = {
  title: 'Adapter migration', state: 'open', draft: false, updated_at: '2026-09-09T00:00:00.000Z', user: { login: 'teammate' }, labels: [{ name: 'team' }],
  head: { sha: 'abcdef1234567', ref: 'feature', repo: { full_name: 'org/repo' } },
  base: { sha: '1234567abcdef', ref: 'main', repo: { full_name: 'org/repo' } },
  mergeable: true, mergeable_state: 'clean',
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
}

function close(server) {
  return new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  })
}

function localGithubFetch(baseUrl) {
  const nativeFetch = globalThis.fetch
  return (input, init) => {
    const source = input instanceof Request ? input.url : String(input)
    const target = new URL(source)
    return nativeFetch(new URL(`${target.pathname}${target.search}`, baseUrl), init)
  }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1_500
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  return predicate()
}

async function withShortNativeTimeouts(run) {
  const nativeTimeout = AbortSignal.timeout
  const random = Math.random
  const configuredTimeouts = []
  AbortSignal.timeout = ms => {
    configuredTimeouts.push(ms)
    return nativeTimeout.call(AbortSignal, Math.min(ms, 60))
  }
  Math.random = () => 0
  try { return await run(configuredTimeouts) }
  finally {
    AbortSignal.timeout = nativeTimeout
    Math.random = random
  }
}

test('GitHub GET retries native 429 and network failures, but preserves terminal status details', async () => {
  let rateLimitCalls = 0
  let dateRetryCalls = 0
  let cappedRetryCalls = 0
  let networkCalls = 0
  let serverErrorCalls = 0
  let requestTimeoutCalls = 0
  let earlyStatusCalls = 0
  const observed = []
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    observed.push({ path, method: request.method, auth: /^Bearer \S+$/.test(request.headers.authorization ?? ''), accept: request.headers.accept, agent: request.headers['user-agent'] })
    if (path === '/rate-limit') {
      rateLimitCalls++
      if (rateLimitCalls === 1) {
        response.writeHead(429, { 'retry-after': '0.04' })
        response.end('rate limited')
      } else response.end('{"ok":true}')
      return
    }
    if (path === '/retry-date') {
      dateRetryCalls++
      if (dateRetryCalls === 1) {
        response.writeHead(429, { 'retry-after': new Date(Date.now() + 2_000).toUTCString() })
        response.end('rate limited')
      } else response.end('{"dateRetry":true}')
      return
    }
    if (path === '/retry-after-cap') {
      cappedRetryCalls++
      response.writeHead(429, { 'retry-after': '61' })
      response.end('retry-after exceeds cap')
      return
    }
    if (path === '/server-error') {
      serverErrorCalls++
      if (serverErrorCalls === 1) {
        response.writeHead(503)
        response.end('transient server error')
      } else response.end('{"serverRetry":true}')
      return
    }
    if (path === '/too-early') {
      earlyStatusCalls++
      response.writeHead(425)
      response.end('too early')
      return
    }
    if (path === '/request-timeout') {
      requestTimeoutCalls++
      response.writeHead(408)
      response.end('request timeout')
      return
    }
    if (path === '/invalid-json') {
      response.end('{broken')
      return
    }
    if (path === '/network') {
      networkCalls++
      if (networkCalls === 1) { request.socket.destroy(); return }
      response.end('{"recovered":true}')
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"message":"Not Found"}')
  })
  const address = await listen(server)
  const random = Math.random
  Math.random = () => 0
  try {
    const fetcher = localGithubFetch(`http://127.0.0.1:${address.port}`)
    const secondsStart = Date.now()
    const rateLimit = await githubFetch('fixture-token', 'https://api.github.com/rate-limit', undefined, fetcher)
    assert.equal(await rateLimit.text(), '{"ok":true}')
    assert.ok(Date.now() - secondsStart >= 20, 'delta-seconds Retry-After should delay the retry')
    const dateStart = Date.now()
    const dateRetry = await githubFetch('fixture-token', 'https://api.github.com/retry-date', undefined, fetcher)
    assert.equal(await dateRetry.text(), '{"dateRetry":true}')
    assert.ok(Date.now() - dateStart >= 800, 'HTTP-date Retry-After should delay the retry')
    await assert.rejects(
      githubFetch('fixture-token', 'https://api.github.com/retry-after-cap', undefined, fetcher),
      /GitHub GET https:\/\/api\.github\.com\/retry-after-cap → 429: retry-after exceeds cap/,
    )
    const network = await githubFetch('fixture-token', 'https://api.github.com/network', undefined, fetcher)
    assert.equal(await network.text(), '{"recovered":true}')
    const serverError = await githubFetch('fixture-token', 'https://api.github.com/server-error', undefined, fetcher)
    assert.equal(await serverError.text(), '{"serverRetry":true}')
    await assert.rejects(
      githubFetch('fixture-token', 'https://api.github.com/not-found', undefined, fetcher),
      /GitHub GET https:\/\/api\.github\.com\/not-found → 404: \{"message":"Not Found"\}/,
    )
    await assert.rejects(
      githubFetch('fixture-token', 'https://api.github.com/too-early', undefined, fetcher),
      /GitHub GET https:\/\/api\.github\.com\/too-early → 425: too early/,
    )
    await assert.rejects(
      githubFetch('fixture-token', 'https://api.github.com/request-timeout', undefined, fetcher),
      /GitHub GET https:\/\/api\.github\.com\/request-timeout → 408: request timeout/,
    )
    await assert.rejects(githubGet('fixture-token', '/invalid-json', fetcher), SyntaxError)
    assert.equal(rateLimitCalls, 2)
    assert.equal(dateRetryCalls, 2)
    assert.equal(cappedRetryCalls, 1, 'Retry-After above the NET cap should be returned without another request')
    assert.equal(networkCalls, 2)
    assert.equal(serverErrorCalls, 2)
    assert.equal(requestTimeoutCalls, 1, '408 must not be added to the GitHub retry status set')
    assert.equal(earlyStatusCalls, 1, '425 must not be added to the GitHub retry status set')
    assert.ok(observed.every(({ method, auth, accept, agent }) => method === 'GET' && auth && accept === 'application/vnd.github+json' && agent === 'agentskit-code-review'))
  } finally {
    Math.random = random
    await close(server)
  }
})

test('GitHub writes use one native POST and reconcile a committed but lost acknowledgement', async () => {
  const reviews = []
  const writes = []
  const observed = []
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    observed.push({ method: request.method, auth: /^Bearer \S+$/.test(request.headers.authorization ?? ''), contentType: request.headers['content-type'] })
    if (request.method === 'GET' && path.endsWith('/pulls/7/reviews')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(reviews))
      return
    }
    if (request.method === 'POST' && path.endsWith('/pulls/7/reviews')) {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { raw += chunk })
      request.on('end', () => {
        const body = JSON.parse(raw)
        writes.push(body)
        reviews.push({ id: 71, body: body.body })
        response.writeHead(502, { 'content-type': 'application/json' })
        response.end('{"message":"server failed after commit"}')
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  const address = await listen(server)
  try {
    const scm = createGithubScmAdapter({ token: 'fixture-token', fetch: localGithubFetch(`http://127.0.0.1:${address.port}`) })
    const receipt = await scm.publishReview(
      { repository: 'org/repo', id: '7' },
      { channel: 'review', headRevision: pull.head.sha, fingerprint: 'native-lost-ack', verdict: 'APPROVE', summary: 'Native transport acceptance.', annotations: [] },
    )
    assert.equal(receipt.id, '71')
    assert.equal(writes.length, 1)
    assert.equal(writes[0].event, 'COMMENT')
    assert.match(writes[0].body, /Native transport acceptance\./)
    assert.ok(observed.every(({ auth }) => auth))
    assert.equal(observed.filter(({ method }) => method === 'POST').length, 1)
    assert.ok(observed.filter(({ method }) => method === 'POST').every(({ contentType }) => contentType === 'application/json'))
  } finally { await close(server) }
})

test('NET bounded reads cancel declared and chunked oversized native HTTP bodies', async () => {
  const canceled = []
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    response.once('close', () => {
      if (!response.writableFinished) canceled.push(path)
      clearTimeout(timer)
    })
    const timer = setTimeout(() => response.end('67890'), 500)
    if (path === '/declared') response.writeHead(200, { 'content-length': '10' })
    else response.writeHead(200)
    response.write('12345')
  })
  const address = await listen(server)
  try {
    const fetcher = localGithubFetch(`http://127.0.0.1:${address.port}`)
    for (const path of ['/declared', '/chunked']) {
      const response = await githubFetch('fixture-token', `https://api.github.com${path}`, undefined, fetcher)
      await assert.rejects(readGithubResponseText(response, 4), error => {
        assert.ok(error instanceof GithubResponseLimitError)
        assert.equal(error.maxBytes, 4)
        assert.equal(error.cause?.code, 'AK_NET_BODY_TOO_LARGE')
        return true
      })
      assert.equal(await waitFor(() => canceled.includes(path)), true, `${path} transport should close after overflow`)
    }
    assert.deepEqual(canceled.sort(), ['/chunked', '/declared'])
  } finally { await close(server) }
})

test('NET per-attempt timeout cancels native GETs before headers and while reading a body, then recovers', async () => {
  await withShortNativeTimeouts(async configuredTimeouts => {
    let waitingHeaders = 0
    let bodyRequests = 0
    const canceled = []
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://127.0.0.1').pathname
      if (path === '/headers') waitingHeaders++
      if (path === '/body') bodyRequests++
      const timer = setTimeout(() => response.end('late response'), 500)
      response.once('close', () => {
        if (!response.writableFinished) canceled.push(path)
        clearTimeout(timer)
      })
      if (path === '/headers') return
      response.writeHead(200, { 'content-type': 'application/json' })
      if (path === '/body' && bodyRequests === 1) response.write('{"ok":')
      else response.end(path === '/body' ? '{"recovered":true}' : '{"ok":true}')
    })
    const address = await listen(server)
    try {
      const fetcher = localGithubFetch(`http://127.0.0.1:${address.port}`)
      await assert.rejects(
        githubFetch('fixture-token', 'https://api.github.com/headers', undefined, fetcher),
        error => error?.code === 'AK_NET_TIMEOUT',
      )
      assert.equal(waitingHeaders, 2, 'the idempotent GET should retry once after a timed out attempt')
      assert.equal(await waitFor(() => canceled.filter(path => path === '/headers').length === 2), true)

      const firstBody = await githubFetch('fixture-token', 'https://api.github.com/body', undefined, fetcher)
      await assert.rejects(readGithubResponseText(firstBody), error => error instanceof Error && /abort|timeout|terminated/i.test(`${error.name} ${error.message}`))
      assert.equal(await waitFor(() => canceled.includes('/body')), true, 'the streaming transport should close on its request deadline')

      const recovered = await githubFetch('fixture-token', 'https://api.github.com/body', undefined, fetcher)
      assert.equal(await readGithubResponseText(recovered), '{"recovered":true}')
      assert.equal(bodyRequests, 2)
      assert.ok(configuredTimeouts.length >= 4 && configuredTimeouts.every(ms => ms === 30_000))
    } finally { await close(server) }
  })
})

test('NET timeout cancels a native mutation response body without retry, then a later merge succeeds', async () => {
  await withShortNativeTimeouts(async configuredTimeouts => {
    const writes = []
    let canceled = false
    const server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { raw += chunk })
      request.on('end', () => {
        writes.push({ method: request.method, auth: /^Bearer \S+$/.test(request.headers.authorization ?? ''), contentType: request.headers['content-type'], body: JSON.parse(raw) })
        response.writeHead(200, { 'content-type': 'application/json' })
        if (writes.length === 1) {
          const timer = setTimeout(() => response.end('{"merged":true,"sha":"late"}'), 500)
          response.once('close', () => {
            if (!response.writableFinished) canceled = true
            clearTimeout(timer)
          })
          response.write('{"merged":')
        } else response.end('{"merged":true,"sha":"fedcba7654321"}')
      })
    })
    const address = await listen(server)
    try {
      const scm = createGithubScmAdapter({ token: 'fixture-token', fetch: localGithubFetch(`http://127.0.0.1:${address.port}`) })
      const request = { expectedHeadRevision: pull.head.sha, method: 'squash', admin: false }
      await assert.rejects(scm.merge({ repository: 'org/repo', id: '7' }, request), error => error instanceof Error && /abort|timeout|terminated/i.test(`${error.name} ${error.message}`))
      assert.equal(await waitFor(() => canceled), true, 'the mutation response transport should close after its deadline')
      assert.equal(writes.length, 1, 'a failed PUT response body must not cause an automatic mutation retry')
      const merged = await scm.merge({ repository: 'org/repo', id: '7' }, request)
      assert.equal(merged.revision, 'fedcba7654321')
      assert.equal(writes.length, 2)
      assert.ok(writes.every(({ method, auth, contentType, body }) => method === 'PUT' && auth && contentType === 'application/json' && body.sha === pull.head.sha))
      assert.ok(configuredTimeouts.length >= 2 && configuredTimeouts.every(ms => ms === 30_000))
    } finally { await close(server) }
  })
})

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
  const readiness = async (policy, checkRuns, reviews = []) => {
    const fakeFetch = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/pulls/7')) return Response.json(pull)
      if (parsed.pathname.endsWith('/check-runs')) return Response.json({ total_count: checkRuns.length, check_runs: checkRuns })
      if (parsed.pathname.endsWith('/status')) return Response.json({ state: 'success', total_count: 0, statuses: [] })
      if (parsed.pathname.endsWith('/reviews')) return Response.json(reviews)
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
  const requested = { state: 'CHANGES_REQUESTED', user: { login: 'reviewer' } }
  assert.equal((await readiness({ mode: 'reported' }, [], [requested])).ready, false)
  assert.equal((await readiness({ mode: 'reported' }, [], [requested, { ...requested, state: 'COMMENT' }])).ready, false)
  assert.equal((await readiness({ mode: 'reported' }, [], [requested, { ...requested, state: 'APPROVED' }])).ready, true)
  assert.equal((await readiness({ mode: 'reported' }, [], [{ ...requested, state: 'DISMISSED' }])).ready, true)
  assert.equal((await readiness({ mode: 'reported' }, [], [{ state: 'CHANGES_REQUESTED' }])).ready, false)
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

test('inline-only policy reads review history while default completion requires the final summary', async () => {
  const marker = `<!-- agentskit-code-review:v1 sha=${pull.head.sha} fingerprint=stable -->`
  const fetcher = async url => {
    const path = new URL(url).pathname
    if (path.endsWith('/pulls/7')) return Response.json(pull)
    if (path.endsWith('/reviews')) return Response.json([{ id: 44, body: marker }])
    if (path.endsWith('/comments')) return Response.json([])
    throw new Error(`unexpected request ${path}`)
  }
  for (const channel of ['review', 'summary']) {
    const scm = createGithubScmAdapter({ token: 'fixture', fetch: fetcher, reviewStateChannel: channel })
    assert.equal((await scm.reviewState({ repository: 'org/repo', id: '7' }, 'stable')).alreadyPublished, channel === 'review')
  }
})

test('lost POST acknowledgements are reconciled without duplicate review or summary writes', async () => {
  for (const channel of ['review', 'summary']) for (const committed of [true, false]) {
    const history = []
    let writes = 0
    const scm = createGithubScmAdapter({ token: 'fixture', fetch: async (_url, init = {}) => {
      if ((init.method ?? 'GET') === 'GET') return Response.json(history)
      writes++
      if (committed) history.push({ id: 71, body: JSON.parse(init.body).body })
      return Response.json({ message: 'Server Error' }, { status: 502 })
    } })
    const input = { channel, headRevision: pull.head.sha, fingerprint: 'lost-ack', verdict: 'COMMENT', summary: 'Measured result.', annotations: [] }
    if (committed) {
      assert.equal((await scm.publishReview({ repository: 'org/repo', id: '7' }, input)).id, '71')
      assert.equal((await scm.publishReview({ repository: 'org/repo', id: '7' }, input)).id, '71')
    } else await assert.rejects(scm.publishReview({ repository: 'org/repo', id: '7' }, input), /502/)
    assert.equal(writes, 1, 'a missing acknowledgement must never cause a blind retry')
  }
})
