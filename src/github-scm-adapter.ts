import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ChangeRequestDiffSchema, ChangeRequestMetadataSchema, ChangeRequestQuerySchema, ChangeRequestRefSchema,
  ScmCapabilitiesSchema, ScmFileContentSchema, ScmMergeReadinessSchema, ScmMergeReceiptSchema,
  ScmMergeRequestSchema, ScmPublicationReceiptSchema, ScmReviewPublicationSchema, ScmReviewStateSchema,
  requireScmCapability,
  type ChangeRequestDiff, type ChangeRequestMetadata, type ChangeRequestQuery, type ChangeRequestRef,
  type ScmAdapter, type ScmFileContent, type ScmMergeReadiness, type ScmMergeReceipt, type ScmMergeRequest,
  type ScmPublicationReceipt, type ScmReviewPublication, type ScmReviewState,
} from './scm-contract.js'
import {
  GITHUB_REQUEST_TIMEOUT_MS, GithubResponseLimitError, githubFetch, githubGet, githubIssueComments,
  getGithubReviewState, readGithubResponseText, reviewMarker,
} from './github-review-state.js'

const run = promisify(execFile)
const MAX_FILES = 500
const MAX_DISCOVERY_PAGES = 10
const PAGE_SIZE = 100

type CommandRunner = (command: string, args: readonly string[]) => Promise<{ stdout?: string; stderr?: string }>

export interface GithubScmAdapterOptions {
  token: string
  fetch?: typeof fetch
  command?: CommandRunner
}

function coordinates(ref: ChangeRequestRef): { owner: string; repo: string; number: number } {
  const parsed = ChangeRequestRefSchema.parse(ref)
  const [owner, repo] = parsed.repository.split('/')
  const number = Number(parsed.id)
  if (!owner || !repo || !Number.isSafeInteger(number) || number < 1) throw new Error(`invalid GitHub change-request reference ${parsed.repository}#${parsed.id}`)
  return { owner, repo, number }
}

function status(value: string): 'added' | 'modified' | 'removed' | 'renamed' | 'copied' {
  return ['added', 'modified', 'removed', 'renamed', 'copied'].includes(value)
    ? value as 'added' | 'modified' | 'removed' | 'renamed' | 'copied'
    : 'modified'
}

export function createGithubScmAdapter(options: GithubScmAdapterOptions): ScmAdapter {
  if (!options.token) throw new Error('GitHub SCM adapter needs a token')
  const fetcher = options.fetch ?? fetch
  const command = options.command ?? (async (executable, args) => run(executable, [...args], { timeout: 180_000, maxBuffer: 1024 * 1024 }))
  const capabilities = ScmCapabilitiesSchema.parse(Object.fromEntries([
    'discovery', 'metadata', 'diff', 'file-content', 'review-state', 'publish-review', 'merge-readiness', 'merge',
  ].map((capability) => [capability, true])))
  const api = <T>(token: string, path: string) => githubGet<T>(token, path, fetcher)

  const mutate = async <T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> => {
    const response = await fetcher(`https://api.github.com${path}`, {
      method,
      headers: { authorization: `Bearer ${options.token}`, accept: 'application/vnd.github+json', 'user-agent': 'agentskit-code-review', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const detail = (await readGithubResponseText(response, 4_096)).trim().slice(0, 300)
      throw new Error(`GitHub ${method} ${path} → ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    const text = await readGithubResponseText(response)
    return (text ? JSON.parse(text) : {}) as T
  }

  const adapter: ScmAdapter = {
    id: 'github',
    capabilities,

    async discover(input: ChangeRequestQuery): Promise<readonly ChangeRequestRef[]> {
      requireScmCapability(adapter, 'discovery')
      const query = ChangeRequestQuerySchema.parse(input)
      const [owner, repo] = query.repository.split('/') as [string, string]
      const found: ChangeRequestRef[] = []
      for (let page = 1; page <= MAX_DISCOVERY_PAGES; page++) {
        const pulls = await api<Array<{ number: number; user?: { login?: string }; labels?: Array<{ name?: string }> }>>(options.token, `/repos/${owner}/${repo}/pulls?state=${query.state}&per_page=${PAGE_SIZE}&page=${page}`)
        for (const pull of pulls) {
          const author = pull.user?.login ?? ''
          const labels = new Set((pull.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)))
          if (query.authors.length && !query.authors.includes(author)) continue
          if (query.excludeAuthors.includes(author)) continue
          if (query.labels.some((label) => !labels.has(label))) continue
          found.push(ChangeRequestRefSchema.parse({ repository: query.repository, id: String(pull.number) }))
        }
        if (pulls.length < PAGE_SIZE) break
        if (page === MAX_DISCOVERY_PAGES) throw new Error(`GitHub change-request discovery exceeded ${MAX_DISCOVERY_PAGES * PAGE_SIZE} pull requests`)
      }
      return found
    },

    async metadata(ref: ChangeRequestRef): Promise<ChangeRequestMetadata> {
      requireScmCapability(adapter, 'metadata')
      const { owner, repo, number } = coordinates(ref)
      const pull = await api<{
        title: string; state: 'open' | 'closed'; draft?: boolean; updated_at: string; user?: { login?: string }; labels?: Array<{ name?: string }>
        head: { sha: string; ref: string; repo?: { full_name?: string } }; base: { sha: string; ref: string; repo?: { full_name?: string } }
      }>(options.token, `/repos/${owner}/${repo}/pulls/${number}`)
      return ChangeRequestMetadataSchema.parse({
        ref, title: pull.title, state: pull.state, author: pull.user?.login ?? 'unknown', sourceRevision: pull.head.sha,
        targetRevision: pull.base.sha, sourceBranch: pull.head.ref, targetBranch: pull.base.ref,
        isDraft: Boolean(pull.draft), isFork: pull.head.repo?.full_name !== undefined && pull.head.repo.full_name !== pull.base.repo?.full_name,
        labels: (pull.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)), updatedAt: pull.updated_at,
      })
    },

    async diff(ref: ChangeRequestRef, baselineRevision?: string): Promise<ChangeRequestDiff> {
      requireScmCapability(adapter, 'diff')
      const { owner, repo, number } = coordinates(ref)
      const pull = await api<{ head: { sha: string }; base?: { sha?: string } }>(options.token, `/repos/${owner}/${repo}/pulls/${number}`)
      const files: Array<{ filename: string; previous_filename?: string; patch?: string; status: string }> = []
      let complete = true
      if (baselineRevision) {
        const comparison = await api<{ files?: typeof files }>(options.token, `/repos/${owner}/${repo}/compare/${baselineRevision}...${pull.head.sha}`)
        const batch = comparison.files ?? []
        complete = batch.length <= MAX_FILES
        files.push(...batch.slice(0, MAX_FILES))
      } else {
        for (let page = 1; ; page++) {
          const batch = await api<typeof files>(options.token, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=${PAGE_SIZE}&page=${page}`)
          const remaining = MAX_FILES - files.length
          files.push(...batch.slice(0, remaining))
          if (batch.length < PAGE_SIZE) break
          if (remaining <= batch.length) { complete = false; break }
        }
      }
      return ChangeRequestDiffSchema.parse({
        baseRevision: baselineRevision ?? pull.base?.sha ?? pull.head.sha,
        headRevision: pull.head.sha,
        complete,
        files: files.map((file) => ({ path: file.filename, ...(file.previous_filename ? { previousPath: file.previous_filename } : {}), status: status(file.status), ...(file.patch ? { patch: file.patch } : {}), truncated: false })),
      })
    },

    async fileContent(ref: ChangeRequestRef, path: string, revision: string, maxBytes: number): Promise<ScmFileContent> {
      requireScmCapability(adapter, 'file-content')
      const { owner, repo } = coordinates(ref)
      const content = await api<{ content: string; encoding: string; download_url?: string }>(options.token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${revision}`)
      if (content.encoding !== 'none') {
        const decoded = Buffer.from(content.content, content.encoding as BufferEncoding)
        return ScmFileContentSchema.parse({ content: decoded.byteLength <= maxBytes ? decoded.toString('utf8') : '', truncated: decoded.byteLength > maxBytes })
      }
      if (!content.download_url) throw new Error(`GitHub contents response has no download URL for ${path}`)
      const url = new URL(content.download_url)
      if (url.hostname !== 'raw.githubusercontent.com') throw new Error(`GitHub contents response has an unsafe download URL for ${path}`)
      const response = await githubFetch(options.token, url.toString(), 'application/vnd.github.raw', fetcher)
      try { return ScmFileContentSchema.parse({ content: await readGithubResponseText(response, maxBytes), truncated: false }) }
      catch (error) {
        if (!(error instanceof GithubResponseLimitError)) throw error
        return ScmFileContentSchema.parse({ content: '', truncated: true })
      }
    },

    async reviewState(ref: ChangeRequestRef, fingerprint: string): Promise<ScmReviewState> {
      requireScmCapability(adapter, 'review-state')
      const { owner, repo, number } = coordinates(ref)
      const state = await getGithubReviewState({ owner, repo, number, token: options.token, fingerprint, fetcher })
      return ScmReviewStateSchema.parse({ headRevision: state.sha, fingerprint, alreadyPublished: state.alreadyReviewed, scope: state.scope, baselineRevision: state.baselineSha ?? null })
    },

    async publishReview(ref: ChangeRequestRef, input: ScmReviewPublication): Promise<ScmPublicationReceipt> {
      requireScmCapability(adapter, 'publish-review')
      const review = ScmReviewPublicationSchema.parse(input)
      const { owner, repo, number } = coordinates(ref)
      const marker = review.fingerprint ? reviewMarker(review.headRevision, review.fingerprint) : undefined
      if (review.channel === 'summary') {
        const body = `${marker ? `${marker}\n` : ''}${review.summary}`
        if (!marker) {
          const posted = await mutate<{ id?: number; html_url?: string }>('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })
          return ScmPublicationReceiptSchema.parse({ id: String(posted.id ?? 'summary'), ...(posted.html_url ? { url: posted.html_url } : {}) })
        }
        const history = await githubIssueComments(options.token, owner, repo, number, fetcher)
        if (history.truncated) throw new Error('GitHub review comment history is too large to update safely')
        const existing = history.comments.find((comment) => comment.id !== undefined && comment.body?.includes(marker))
        if (existing?.id !== undefined) {
          await mutate('PATCH', `/repos/${owner}/${repo}/issues/comments/${existing.id}`, { body })
          return ScmPublicationReceiptSchema.parse({ id: String(existing.id) })
        }
        const posted = await mutate<{ id?: number; html_url?: string }>('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })
        return ScmPublicationReceiptSchema.parse({ id: String(posted.id ?? 'summary'), ...(posted.html_url ? { url: posted.html_url } : {}) })
      }
      const body = `${marker ? `${marker}\n` : ''}${review.summary}`
      const payload = { body, commit_id: review.headRevision, ...(review.annotations.length ? { comments: review.annotations.map((annotation) => ({ path: annotation.path, line: annotation.endLine ?? annotation.line, body: annotation.body })) } : {}) }
      const event = review.verdict === 'REQUEST_CHANGES' ? 'REQUEST_CHANGES' : 'COMMENT'
      let posted: { id?: number; html_url?: string }
      try { posted = await mutate('POST', `/repos/${owner}/${repo}/pulls/${number}/reviews`, { event, ...payload }) }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('422')) throw error
        posted = await mutate('POST', `/repos/${owner}/${repo}/pulls/${number}/reviews`, { event: 'COMMENT', ...payload })
      }
      return ScmPublicationReceiptSchema.parse({ id: String(posted.id ?? 'review'), ...(posted.html_url ? { url: posted.html_url } : {}) })
    },

    async mergeReadiness(ref: ChangeRequestRef): Promise<ScmMergeReadiness> {
      requireScmCapability(adapter, 'merge-readiness')
      const { owner, repo, number } = coordinates(ref)
      const pull = await api<{ draft?: boolean; mergeable?: boolean | null; mergeable_state?: string; head: { sha: string } }>(options.token, `/repos/${owner}/${repo}/pulls/${number}`)
      const checks = await api<{ total_count?: number; check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }> }>(options.token, `/repos/${owner}/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`)
      const statuses = await api<{ state?: string; total_count?: number; statuses?: unknown[] }>(options.token, `/repos/${owner}/${repo}/commits/${pull.head.sha}/status`)
      const blockers: string[] = []
      if (pull.draft) blockers.push('change request is draft')
      if (pull.mergeable !== true) blockers.push(`mergeable=${String(pull.mergeable)}`)
      if (!['clean', 'has_hooks'].includes(pull.mergeable_state ?? 'unknown')) blockers.push(`merge state=${pull.mergeable_state ?? 'unknown'}`)
      if (!Array.isArray(checks.check_runs) || !Number.isSafeInteger(checks.total_count)) blockers.push('check-run readiness response is incomplete')
      if ((checks.total_count ?? 0) > (checks.check_runs?.length ?? 0)) blockers.push('check runs exceed bounded readiness response')
      for (const check of checks.check_runs ?? []) {
        if (check.status !== 'completed' || !['success', 'neutral', 'skipped'].includes(check.conclusion ?? '')) blockers.push(`check ${check.name ?? 'unknown'}=${check.status}/${check.conclusion ?? 'pending'}`)
      }
      if (!Array.isArray(statuses.statuses) || !Number.isSafeInteger(statuses.total_count)) blockers.push('commit-status readiness response is incomplete')
      if ((statuses.total_count ?? 0) > 0 && statuses.state !== 'success') blockers.push(`commit status=${statuses.state ?? 'unknown'}`)
      return ScmMergeReadinessSchema.parse({ headRevision: pull.head.sha, ready: blockers.length === 0, blockers })
    },

    async merge(ref: ChangeRequestRef, input: ScmMergeRequest): Promise<ScmMergeReceipt> {
      requireScmCapability(adapter, 'merge')
      const request = ScmMergeRequestSchema.parse(input)
      const { owner, repo, number } = coordinates(ref)
      if (request.admin) {
        await command('gh', ['pr', 'merge', String(number), '-R', `${owner}/${repo}`, `--${request.method}`, '--admin', '--match-head-commit', request.expectedHeadRevision])
        return ScmMergeReceiptSchema.parse({ revision: request.expectedHeadRevision, mergedAt: new Date().toISOString() })
      }
      const merged = await mutate<{ merged?: boolean; sha?: string; message?: string }>('PUT', `/repos/${owner}/${repo}/pulls/${number}/merge`, { sha: request.expectedHeadRevision, merge_method: request.method })
      if (!merged.merged || !merged.sha) throw new Error(`GitHub merge rejected: ${merged.message ?? 'unknown reason'}`)
      return ScmMergeReceiptSchema.parse({ revision: merged.sha, mergedAt: new Date().toISOString() })
    },
  }
  return adapter
}
