import { createHash } from 'node:crypto'
import { fetchWithRetry, NetError, NetErrorCodes, readText } from '@agentskit/net'

const API = 'https://api.github.com'
/** Per-attempt GitHub request timeout in milliseconds. */
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000
/** Default maximum buffered GitHub response body (25 MiB). */
export const MAX_GITHUB_RESPONSE_BYTES = 25 * 1024 * 1024
const MARKER_PREFIX = '<!-- agentskit-code-review:v1'
const COMMENT_PAGE_SIZE = 100
const MAX_COMMENT_PAGES = 10
const REVIEW_PAGE_SIZE = 100
const MAX_REVIEW_PAGES = 10
const GITHUB_RETRY_STATUSES = [429, ...Array.from({ length: 100 }, (_, index) => 500 + index)]

/**
 * GitHub response bodies larger than the requested byte limit.
 * @param maxBytes Limit that was exceeded.
 * @param cause NET `AK_NET_BODY_TOO_LARGE` error from the underlying body reader.
 */
export class GithubResponseLimitError extends Error {
  constructor(readonly maxBytes: number, cause?: unknown) {
    super(`GitHub response exceeded ${maxBytes} byte limit`, cause === undefined ? undefined : { cause })
    this.name = 'GithubResponseLimitError'
  }
}

export interface GithubReviewIdentity {
  owner: string
  repo: string
  number: number
  sha: string
  baseSha: string
  fork: boolean
}

export interface GithubReviewState extends GithubReviewIdentity {
  fingerprint: string
  marker: string
  alreadyReviewed: boolean
  scope: 'incremental' | 'full'
  baselineSha?: string
}

export function reviewFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function reviewMarker(sha: string, fingerprint: string): string {
  return `${MARKER_PREFIX} sha=${sha} fingerprint=${fingerprint} -->`
}

/**
 * Read a bounded UTF-8 GitHub body; the default limit is 25 MiB.
 * `maxBytes` must be a non-negative integer. Overflow throws
 * `GithubResponseLimitError` with the NET `AK_NET_BODY_TOO_LARGE` error as its cause.
 * @param response Response whose body should be read.
 * @param maxBytes Maximum bytes to read; defaults to 25 MiB.
 */
export async function readGithubResponseText(response: Response, maxBytes = MAX_GITHUB_RESPONSE_BYTES): Promise<string> {
  try {
    return await readText(response, { maxBytes })
  } catch (error) {
    if (error instanceof NetError && error.code === NetErrorCodes.AK_NET_BODY_TOO_LARGE) {
      throw new GithubResponseLimitError(maxBytes, error)
    }
    throw error
  }
}

async function responseDetail(response: Response): Promise<string> {
  try { return (await readGithubResponseText(response, 4096)).trim().slice(0, 300) }
  catch (error) { return error instanceof GithubResponseLimitError ? error.message : '' }
}

/**
 * Fetch a GitHub GET with two total attempts and a 30-second per-attempt timeout.
 * Network failures, 429 and 5xx responses retry once using 250 ms-base full jitter;
 * `Retry-After` is honored up to 60 seconds. 408, 425 and other HTTP statuses are not retried.
 * Non-2xx responses retain the `GitHub GET <url> → <status>: <detail>` error format.
 *
 * @param token Bearer token used for GitHub API authentication.
 * @param url Request URL.
 * @param accept GitHub media type; defaults to `application/vnd.github+json`.
 * @param fetcher Injectable fetch implementation; defaults to `globalThis.fetch`.
 */
export async function githubFetch(token: string, url: string, accept = 'application/vnd.github+json', fetcher: typeof fetch = fetch): Promise<Response> {
  const response = await fetchWithRetry(url, {
    headers: { authorization: `Bearer ${token}`, accept, 'user-agent': 'agentskit-code-review' },
  }, {
    timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
    retries: 1,
    retryMethods: ['GET'],
    retryStatuses: GITHUB_RETRY_STATUSES,
    minDelayMs: 250,
    maxDelayMs: 10_000,
    jitter: 'full',
    maxRetryAfterMs: 60_000,
    fetch: fetcher,
  })
  if (!response.ok) {
    const detail = await responseDetail(response)
    throw new Error(`GitHub GET ${url} → ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response
}

export async function githubGet<T>(token: string, path: string, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await githubFetch(token, `${API}${path}`, 'application/vnd.github+json', fetcher)
  return JSON.parse(await readGithubResponseText(response)) as T
}

export interface GithubIssueComment {
  id?: number
  body?: string
}

export interface GithubPullReview {
  id?: number
  html_url?: string
  body?: string
  state?: string
  user?: { login?: string }
}

export async function githubIssueComments(token: string, owner: string, repo: string, number: number, fetcher: typeof fetch = fetch): Promise<{ comments: GithubIssueComment[]; truncated: boolean }> {
  const comments: GithubIssueComment[] = []
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const batch = await githubGet<GithubIssueComment[]>(token, `/repos/${owner}/${repo}/issues/${number}/comments?per_page=${COMMENT_PAGE_SIZE}&page=${page}&sort=created&direction=desc`, fetcher)
    comments.push(...batch)
    if (batch.length < COMMENT_PAGE_SIZE) return { comments, truncated: false }
  }
  return { comments, truncated: true }
}

export async function githubPullReviews(token: string, owner: string, repo: string, number: number, fetcher: typeof fetch = fetch): Promise<{ reviews: GithubPullReview[]; truncated: boolean }> {
  const reviews: GithubPullReview[] = []
  for (let page = 1; page <= MAX_REVIEW_PAGES; page++) {
    const batch = await githubGet<GithubPullReview[]>(token, `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=${REVIEW_PAGE_SIZE}&page=${page}`, fetcher)
    reviews.push(...batch)
    if (batch.length < REVIEW_PAGE_SIZE) return { reviews, truncated: false }
  }
  return { reviews, truncated: true }
}

export interface GithubReviewComment {
  id?: number
  path?: string
  line?: number | null
  start_line?: number | null
  body?: string
}

const REVIEW_COMMENT_PAGE_SIZE = 100
const MAX_REVIEW_COMMENT_PAGES = 10

/** Existing inline review comments (not the review summary bodies) — used to detect a
 * line-range overlap with a previous run's comments before re-posting the same finding. */
export async function githubReviewComments(token: string, owner: string, repo: string, number: number, fetcher: typeof fetch = fetch): Promise<{ comments: GithubReviewComment[]; truncated: boolean }> {
  const comments: GithubReviewComment[] = []
  for (let page = 1; page <= MAX_REVIEW_COMMENT_PAGES; page++) {
    const batch = await githubGet<GithubReviewComment[]>(token, `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=${REVIEW_COMMENT_PAGE_SIZE}&page=${page}`, fetcher)
    comments.push(...batch)
    if (batch.length < REVIEW_COMMENT_PAGE_SIZE) return { comments, truncated: false }
  }
  return { comments, truncated: true }
}

/** Line-range Intersection-over-Union between a candidate annotation and an existing
 * review comment on the same file. GitHub's own `line`/`start_line` model a single line
 * as `start_line: null, line: N` — normalized here to a closed `[start, end]` range. */
export function lineRangeOverlap(candidate: { path: string; line: number; endLine?: number }, existing: GithubReviewComment): number {
  if (existing.path !== candidate.path || existing.line == null) return 0
  const existingStart = existing.start_line ?? existing.line
  const existingEnd = existing.line
  const candidateStart = candidate.line
  const candidateEnd = candidate.endLine ?? candidate.line
  const intersectionStart = Math.max(existingStart, candidateStart)
  const intersectionEnd = Math.min(existingEnd, candidateEnd)
  const intersection = Math.max(0, intersectionEnd - intersectionStart + 1)
  if (!intersection) return 0
  const union = (existingEnd - existingStart + 1) + (candidateEnd - candidateStart + 1) - intersection
  return intersection / union
}

/** True when a candidate annotation's line range overlaps ANY existing review comment on
 * the same file at or above `threshold` (default 0.6, matching `open-code-review`'s IoU
 * cutoff for the same problem). */
export function overlapsExistingComment(candidate: { path: string; line: number; endLine?: number }, existing: readonly GithubReviewComment[], threshold = 0.6): boolean {
  return existing.some((comment) => lineRangeOverlap(candidate, comment) >= threshold)
}

export function markerIn(body: string | undefined, marker: string): boolean {
  return body?.includes(marker) ?? false
}

function previousMarker(body: string | undefined, fingerprint: string): string | undefined {
  const match = body?.match(new RegExp(`${MARKER_PREFIX} sha=([^ ]+) fingerprint=${fingerprint} -->`))
  return match?.[1]
}

export async function getGithubReviewState(input: {
  owner: string
  repo: string
  number: number
  token: string
  fingerprint: string
  fetcher?: typeof fetch
  channel?: 'review' | 'summary'
}): Promise<GithubReviewState> {
  const pr = await githubGet<{
    head: { sha: string; repo?: { full_name?: string } }
    base: { sha: string; repo?: { full_name?: string } }
  }>(input.token, `/repos/${input.owner}/${input.repo}/pulls/${input.number}`, input.fetcher)
  const marker = reviewMarker(pr.head.sha, input.fingerprint)
  const history = input.channel === 'review'
    ? await githubPullReviews(input.token, input.owner, input.repo, input.number, input.fetcher)
    : await githubIssueComments(input.token, input.owner, input.repo, input.number, input.fetcher)
  if (history.truncated) throw new Error(`GitHub review comment history exceeded ${MAX_COMMENT_PAGES * COMMENT_PAGE_SIZE} comments; refusing to post without idempotency proof`)
  const comments = 'comments' in history ? history.comments : history.reviews
  const previousSha = comments.map((comment) => previousMarker(comment.body, input.fingerprint)).find(Boolean)
  let scope: GithubReviewState['scope'] = 'full'
  if (previousSha && previousSha !== pr.head.sha) {
    const comparison = await githubGet<{ status?: string }>(input.token, `/repos/${input.owner}/${input.repo}/compare/${previousSha}...${pr.head.sha}`, input.fetcher)
    if (comparison.status === 'ahead') scope = 'incremental'
  }
  return {
    owner: input.owner,
    repo: input.repo,
    number: input.number,
    sha: pr.head.sha,
    baseSha: pr.base.sha,
    fork: pr.head.repo?.full_name !== undefined && pr.head.repo.full_name !== pr.base.repo?.full_name,
    fingerprint: input.fingerprint,
    marker,
    alreadyReviewed: comments.some((comment) => markerIn(comment.body, marker)),
    scope,
    ...(scope === 'incremental' && previousSha ? { baselineSha: previousSha } : {}),
  }
}
