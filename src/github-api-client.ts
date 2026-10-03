import { fetchWithRetry, parseRetryAfter, readJson, readText, retry } from '@agentskit/net'

export const GITHUB_API_BASE_URL = 'https://api.github.com'
export const GITHUB_API_VERSION = '2022-11-28'
const MAX_ERROR_BYTES = 4 * 1024
const MAX_RETRY_AFTER_MS = 60_000
const MAX_PAGES = 100
const MAX_REDIRECTS = 3
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000
export const MAX_GITHUB_RESPONSE_BYTES = 25 * 1024 * 1024

interface GithubClientOptions {
  token: string
  fetch?: typeof fetch
  baseUrl?: string
}

interface GithubRequestOptions {
  method?: string
  accept?: string
  body?: unknown
  authenticated?: boolean
}

interface RetryableRateLimit {
  response: Response
  message: string
}

function isRetryableRateLimit(error: unknown): error is RetryableRateLimit {
  return typeof error === 'object' && error !== null && 'response' in error && 'message' in error
    && (error as RetryableRateLimit).response instanceof Response
}

function parseNextLink(link: string | null): string | undefined {
  if (!link) return undefined
  for (const part of link.split(',')) {
    const match = part.match(/^\s*<([^>]+)>\s*;(.*)$/)
    if (match && /(?:^|;)\s*rel\s*=\s*(?:"next"|next)(?:\s*;|$)/i.test(match[2]!)) return match[1]
  }
  return undefined
}

function isRateLimit(response: Response, message: string): boolean {
  return response.status === 429
    || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0'
      || response.headers.has('retry-after') || response.headers.has('x-ratelimit-reset') || /rate limit/i.test(message)))
}

function rateLimitDelay(response: Response): number | undefined {
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
  if (retryAfter !== undefined) return retryAfter
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - Date.now())
  return undefined
}

/** Internal GitHub REST client shared by review-state and SCM calls. */
export function createGithubApiClient({ token, fetch: fetcher = fetch, baseUrl = GITHUB_API_BASE_URL }: GithubClientOptions) {
  const base = new URL(baseUrl)
  if (!token) throw new Error('GitHub API client needs a token')

  function resolveUrl(input: string): URL {
    const url = new URL(input, base)
    if (url.origin !== base.origin) throw new Error(`GitHub API URL escaped configured origin: ${url.origin}`)
    return url
  }

  async function request(input: string, options: GithubRequestOptions = {}): Promise<Response> {
    const url = resolveUrl(input)
    const method = (options.method ?? 'GET').toUpperCase()
    const authenticated = options.authenticated !== false
    const headers = new Headers({
      accept: options.accept ?? 'application/vnd.github+json',
      'user-agent': 'agentskit-code-review',
      'x-github-api-version': GITHUB_API_VERSION,
    })
    if (authenticated) headers.set('authorization', `Bearer ${token}`)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    const init: RequestInit = {
      method,
      headers,
      redirect: 'manual',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }
    const fetchOptions = {
      timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
      retries: method === 'GET' ? 1 : 0,
      retryMethods: method === 'GET' ? ['GET'] : [],
      retryStatuses: Array.from({ length: 100 }, (_, index) => 500 + index),
      minDelayMs: 250,
      maxDelayMs: 10_000,
      jitter: 'full' as const,
      maxRetryAfterMs: MAX_RETRY_AFTER_MS,
      // Keep manual redirects so credentials never leave the configured origin.
      // Re-requests use fetchWithRetry's signal, so the entire redirect chain
      // shares one timeout budget and remains part of the same retry attempt.
      fetch: async (input: RequestInfo | URL, requestInit?: RequestInit): Promise<Response> => {
        let target = new URL(input instanceof Request ? input.url : input.toString())
        for (let redirects = 0; ; redirects++) {
          const result = await fetcher(target, { ...requestInit, redirect: 'manual' })
          if (![301, 302, 303, 307, 308].includes(result.status)) return result
          const location = result.headers.get('location')
          if (!location) return result
          const redirected = new URL(location, target)
          if (redirected.origin !== base.origin) {
            void result.body?.cancel().catch(() => {})
            resultRedirectError = `GitHub ${method} redirect to a different origin is blocked: ${redirected.origin}`
            return result
          }
          if (method !== 'GET' && method !== 'HEAD') {
            void result.body?.cancel().catch(() => {})
            resultRedirectError = `GitHub ${method} request was redirected (${result.status}); refusing to follow a write request`
            return result
          }
          if (redirects >= MAX_REDIRECTS) {
            void result.body?.cancel().catch(() => {})
            resultRedirectError = `GitHub ${method} redirect limit exceeded (${MAX_REDIRECTS})`
            return result
          }
          target = redirected
        }
      },
    }
    let response: Response
    let resultRedirectError: string | undefined
    try {
      response = await retry(async () => {
        const result = await fetchWithRetry(url, init, fetchOptions)
        if (method === 'GET' && (result.status === 403 || result.status === 429)) {
          let message = ''
          try { message = await readText(result.clone(), { maxBytes: MAX_ERROR_BYTES }) }
          catch { /* A bounded error preview is optional; headers can still identify primary limits. */ }
          if (isRateLimit(result, message)) throw { response: result, message } satisfies RetryableRateLimit
        }
        return result
      }, {
        retries: 1,
        minDelayMs: 250,
        maxDelayMs: MAX_RETRY_AFTER_MS,
        jitter: 'full',
        shouldRetry: (error) => isRetryableRateLimit(error) && (rateLimitDelay(error.response) ?? 0) <= MAX_RETRY_AFTER_MS,
        delayFor: (error) => isRetryableRateLimit(error) ? rateLimitDelay(error.response) : undefined,
      })
    } catch (error) {
      if (!isRetryableRateLimit(error)) throw error
      response = error.response
    }
    if (resultRedirectError) throw new Error(resultRedirectError)
    if (!response.ok) {
      let detail = ''
      try { detail = (await readText(response, { maxBytes: MAX_ERROR_BYTES })).trim().slice(0, 300) }
      catch { /* Keep status context when GitHub returns an oversized error body. */ }
      throw new Error(`GitHub ${method} ${url} → ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    return response
  }

  async function getJson<T>(input: string): Promise<{ data: T; response: Response }> {
    const response = await request(input)
    return { data: await readJson<T>(response, { maxBytes: MAX_GITHUB_RESPONSE_BYTES }), response }
  }

  async function get<T>(input: string): Promise<T> {
    return (await getJson<T>(input)).data
  }

  async function list<T>(input: string, maxPages = MAX_PAGES): Promise<{ items: T[]; truncated: boolean }> {
    const values: T[] = []
    let next: string | undefined = input
    for (let page = 0; next && page < maxPages; page++) {
      const { data, response } = await getJson<T[]>(next)
      if (!Array.isArray(data)) throw new Error(`GitHub list response was not an array: ${response.url}`)
      values.push(...data)
      const link = parseNextLink(response.headers.get('link'))
      next = link ? resolveUrl(link).toString() : undefined
    }
    return { items: values, truncated: Boolean(next) }
  }

  async function listObject<T extends Record<string, unknown>>(input: string, key: string): Promise<T> {
    let next: string | undefined = input
    let result: T | undefined
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const { data, response } = await getJson<T>(next)
      const batch = data[key]
      if (!Array.isArray(batch)) throw new Error(`GitHub list response omitted ${key}: ${response.url}`)
      result = { ...data, [key]: [...(result?.[key] as unknown[] ?? []), ...batch] } as T
      const link = parseNextLink(response.headers.get('link'))
      next = link ? resolveUrl(link).toString() : undefined
    }
    if (next) throw new Error(`GitHub pagination exceeded ${MAX_PAGES} pages`)
    return result!
  }

  async function json<T>(input: string, options: GithubRequestOptions): Promise<T> {
    const response = await request(input, options)
    return readJson<T>(response, { maxBytes: MAX_GITHUB_RESPONSE_BYTES })
  }

  return { request, get, getJson, list, listObject, json }
}
