import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { githubInlineReporter, renderGithubWalkthrough, sarifReporter } from '../dist/agents/code-review/reporters.js'

const review = {
  verdict: 'REQUEST CHANGES',
  blocking: true,
  incomplete: false,
  findings: [{ file: 'src/example.ts', line: 4, severity: 'high', category: 'correctness', confidence: 0.95, title: 'Example defect', rationale: 'The value is not validated.', suggestion: 'Validate the value before use.', inDiff: true }],
  dropped: [],
  execution: { attempted: 1, succeeded: 1, failed: 0 },
  summary: '1 finding.',
  evidence: {
    profile: 'full',
    providerCalls: 14,
    failedProviderCalls: 0,
    skippedProviderCalls: 0,
    elapsedMs: 1234,
    circuitState: 'closed',
    deadlineExceeded: false,
  },
}

test('GitHub walkthrough preserves a compact PR status without duplicating inline guidance', () => {
  const walkthrough = renderGithubWalkthrough(review)
  assert.match(walkthrough, /AgentsKit review · REQUEST CHANGES/)
  assert.match(walkthrough, /🔴 1 high/)
  assert.match(walkthrough, /Actionable findings are attached inline/)
  assert.match(walkthrough, /Review evidence/)
  assert.doesNotMatch(walkthrough, /Why this needs correction/)
  assert.doesNotMatch(walkthrough, /Validate the value before use/)
})

test('GitHub inline reporter falls back to COMMENT after a rejected event', async () => {
  const originalFetch = globalThis.fetch
  const events = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.match(body.comments[0].body, /Why this needs correction/)
    assert.match(body.comments[0].body, /Required change/)
    assert.match(body.comments[0].body, /Acceptance check/)
    assert.match(body.comments[0].body, /confidence 0\.95/)
    events.push(body.event)
    return events.length === 1
      ? new Response('event rejected', { status: 422 })
      : Response.json({ html_url: 'https://github.test/review/1' })
  }
  try {
    await githubInlineReporter({ owner: 'org', repo: 'repo', number: 1, token: 'test-token', commitId: 'abc123' }).emit(review)
    assert.deepEqual(events, ['REQUEST_CHANGES', 'COMMENT'])
  } finally { globalThis.fetch = originalFetch }
})

test('GitHub inline reporter surfaces non-validation posting failures', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('server failure', { status: 500 })
  try {
    await assert.rejects(
      githubInlineReporter({ owner: 'org', repo: 'repo', number: 1, token: 'test-token', commitId: 'abc123' }).emit(review),
      /GitHub POST .* → 500/,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('GitHub inline reporter applies configured language and section policy', async () => {
  const originalFetch = globalThis.fetch
  let payload
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body))
    return Response.json({ html_url: 'https://github.test/review/2' })
  }
  try {
    await githubInlineReporter({
      owner: 'org', repo: 'repo', number: 2, token: 'test-token', commitId: 'abc123',
      policy: { language: 'pt-BR', includeReason: false, includeImpact: false, includeEvidence: false, renderer: 'compact' },
    }).emit(review)
    assert.equal(payload.comments.length, 1)
    assert.match(payload.comments[0].body, /Alteração necessária/)
    assert.doesNotMatch(payload.comments[0].body, /Por que precisa de correção/)
    assert.doesNotMatch(payload.comments[0].body, /Evidência da revisão/)
    assert.doesNotMatch(payload.comments[0].body, /```diff/)
  } finally { globalThis.fetch = originalFetch }
})

test('GitHub inline reporter can disable both inline and summary output', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return Response.json({ html_url: 'https://github.test/review/3' }) }
  try {
    await githubInlineReporter({ owner: 'org', repo: 'repo', number: 3, token: 'test-token', policy: { inline: false, summary: false } }).emit(review)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('GitHub inline reporter skips a finding whose line overlaps a previous review comment', async () => {
  const twoFindings = {
    ...review,
    findings: [
      { file: 'src/example.ts', line: 4, severity: 'high', category: 'correctness', confidence: 0.95, title: 'Example defect', rationale: 'The value is not validated.', suggestion: 'Validate the value before use.', inDiff: true },
      { file: 'src/other.ts', line: 20, severity: 'high', category: 'security', confidence: 0.9, title: 'Unrelated defect', rationale: 'Different file entirely.', suggestion: 'Fix it.', inDiff: true },
    ],
  }
  const originalFetch = globalThis.fetch
  let posted
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname
    if ((init?.method ?? 'GET') === 'GET' && path.endsWith('/comments')) {
      return Response.json([{ id: 1, path: 'src/example.ts', line: 4, start_line: null, body: 'previously reported' }])
    }
    posted = JSON.parse(String(init.body))
    return Response.json({ html_url: 'https://github.test/review/overlap' })
  }
  try {
    await githubInlineReporter({ owner: 'org', repo: 'repo', number: 9, token: 'test-token', commitId: 'abc123' }).emit(twoFindings)
    assert.equal(posted.comments.length, 1, 'the overlapping finding must not be re-posted')
    assert.equal(posted.comments[0].path, 'src/other.ts')
    assert.match(posted.body, /already reported in a previous review/)
  } finally { globalThis.fetch = originalFetch }
})

test('GitHub inline reporter routes findings below the configured severity into the summary', async () => {
  const mixed = {
    ...review,
    findings: [
      { file: 'src/example.ts', line: 4, severity: 'high', category: 'correctness', confidence: 0.95, title: 'A high finding', rationale: 'Matters a lot.', suggestion: 'Fix it.', inDiff: true },
      { file: 'src/example.ts', line: 10, severity: 'nit', category: 'style', confidence: 0.5, title: 'A nit finding', rationale: 'Minor style issue.', suggestion: 'Consider renaming.', inDiff: true },
    ],
  }
  const originalFetch = globalThis.fetch
  let posted
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname
    if ((init?.method ?? 'GET') === 'GET' && path.endsWith('/comments')) return Response.json([])
    posted = JSON.parse(String(init.body))
    return Response.json({ html_url: 'https://github.test/review/routed' })
  }
  try {
    await githubInlineReporter({ owner: 'org', repo: 'repo', number: 10, token: 'test-token', commitId: 'abc123', policy: { routeSeverityBelow: 'med' } }).emit(mixed)
    assert.equal(posted.comments.length, 1)
    assert.match(posted.comments[0].body, /A high finding/)
    assert.match(posted.body, /A nit finding/, 'the nit finding must appear in the summary instead of inline')
  } finally { globalThis.fetch = originalFetch }
})

test('GitHub inline reporter still posts when fetching review-comment history fails', async () => {
  const originalFetch = globalThis.fetch
  let posted
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname
    if ((init?.method ?? 'GET') === 'GET' && path.endsWith('/comments')) throw new Error('network unavailable')
    posted = JSON.parse(String(init.body))
    return Response.json({ html_url: 'https://github.test/review/resilient' })
  }
  try {
    await githubInlineReporter({ owner: 'org', repo: 'repo', number: 11, token: 'test-token', commitId: 'abc123' }).emit(review)
    assert.equal(posted.comments.length, 1, 'a history-fetch failure must not block posting the finding')
  } finally { globalThis.fetch = originalFetch }
})

test('SARIF reporter matches the 2.1.0 shape and includes a stable partialFingerprints', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentskit-sarif-'))
  const file = join(dir, 'report.sarif')
  try {
    await sarifReporter({ file }).emit(review)
    const sarif = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json')
    assert.equal(sarif.version, '2.1.0')
    assert.equal(sarif.runs.length, 1)
    const [run] = sarif.runs
    assert.equal(run.tool.driver.name, 'agentskit-code-review')
    assert.equal(typeof run.tool.driver.version, 'string')
    assert.ok(run.tool.driver.version.length > 0)
    assert.equal(run.tool.driver.informationUri, 'https://github.com/AgentsKit-io/code-review')
    assert.ok(run.tool.driver.rules.some((rule) => rule.id === 'code-review/correctness'))
    assert.equal(run.results.length, 1)
    const [result] = run.results
    assert.equal(result.ruleId, 'code-review/correctness')
    assert.equal(result.level, 'error')
    assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, 'src/example.ts')
    assert.equal(result.locations[0].physicalLocation.region.startLine, 4)
    assert.equal(typeof result.partialFingerprints.primaryLocationLineHash, 'string')
    assert.equal(result.partialFingerprints.primaryLocationLineHash.length, 64, 'a sha256 hex digest')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SARIF fingerprints are identical across runs and unaffected by an adjacent line shift', async () => {
  const shifted = { ...review, findings: review.findings.map((f) => ({ ...f, line: f.line + 3, endLine: f.endLine ? f.endLine + 3 : undefined })) }
  const dirA = mkdtempSync(join(tmpdir(), 'agentskit-sarif-a-'))
  const dirB = mkdtempSync(join(tmpdir(), 'agentskit-sarif-b-'))
  try {
    const fileA = join(dirA, 'a.sarif')
    const fileB = join(dirB, 'b.sarif')
    await sarifReporter({ file: fileA }).emit(review)
    await sarifReporter({ file: fileB }).emit(review)
    const a = JSON.parse(readFileSync(fileA, 'utf8'))
    const b = JSON.parse(readFileSync(fileB, 'utf8'))
    assert.equal(a.runs[0].results[0].partialFingerprints.primaryLocationLineHash, b.runs[0].results[0].partialFingerprints.primaryLocationLineHash, 'identical runs must produce identical fingerprints')

    const fileC = join(dirA, 'c.sarif')
    await sarifReporter({ file: fileC }).emit(shifted)
    const c = JSON.parse(readFileSync(fileC, 'utf8'))
    assert.equal(c.runs[0].results[0].partialFingerprints.primaryLocationLineHash, a.runs[0].results[0].partialFingerprints.primaryLocationLineHash, 'moving the finding a few lines must not change its fingerprint')
  } finally {
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  }
})
