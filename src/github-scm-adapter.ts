import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createGithubApiClient } from './github-api-client.js'
import {
  ChangeRequestDiffSchema, ChangeRequestMetadataSchema, ChangeRequestQuerySchema, ChangeRequestRefSchema,
  ScmCapabilitiesSchema, ScmFileContentSchema, ScmMergeReadinessSchema, ScmMergeReceiptSchema,
  ScmCheckPolicySchema, ScmMergeRequestSchema, ScmPublicationReceiptSchema, ScmReviewPublicationSchema, ScmReviewStateSchema,
  requireScmCapability,
  type ChangeRequestDiff, type ChangeRequestMetadata, type ChangeRequestQuery, type ChangeRequestRef, type ScmCheckPolicy,
  type ScmAdapter, type ScmFileContent, type ScmMergeReadiness, type ScmMergeReceipt, type ScmMergeRequest,
  type ScmPublicationReceipt, type ScmReviewPublication, type ScmReviewState,
} from './scm-contract.js'
import {
  GithubResponseLimitError, githubIssueComments,
  githubPullReviews, getGithubReviewState, readGithubResponseText, reviewMarker,
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
  reviewStateChannel?: 'review' | 'summary'
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
  const github = createGithubApiClient({ token: options.token, fetch: fetcher })
  const command = options.command ?? (async (executable, args) => run(executable, [...args], { timeout: 180_000, maxBuffer: 1024 * 1024 }))
  const capabilities = ScmCapabilitiesSchema.parse(Object.fromEntries([
    'discovery', 'metadata', 'diff', 'file-content', 'review-state', 'publish-review', 'merge-readiness', 'merge',
  ].map((capability) => [capability, true])))
  const api = <T>(path: string) => github.get<T>(path)

  const mutate = async <T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> => {
    return github.json<T>(path, { method, body })
  }

  const adapter: ScmAdapter = {
    id: 'github',
    capabilities,

    async discover(input: ChangeRequestQuery): Promise<readonly ChangeRequestRef[]> {
      requireScmCapability(adapter, 'discovery')
      const query = ChangeRequestQuerySchema.parse(input)
      const [owner, repo] = query.repository.split('/') as [string, string]
      const found: ChangeRequestRef[] = []
      const { items: pulls, truncated } = await github.list<{ number: number; user?: { login?: string }; labels?: Array<{ name?: string }> }>(`/repos/${owner}/${repo}/pulls?state=${query.state}&per_page=${PAGE_SIZE}`, MAX_DISCOVERY_PAGES)
      for (const pull of pulls) {
        const author = pull.user?.login ?? ''
        const labels = new Set((pull.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)))
        if (query.authors.length && !query.authors.includes(author)) continue
        if (query.excludeAuthors.includes(author)) continue
        if (query.labels.some((label) => !labels.has(label))) continue
        found.push(ChangeRequestRefSchema.parse({ repository: query.repository, id: String(pull.number) }))
      }
      if (truncated) throw new Error(`GitHub change-request discovery exceeded ${MAX_DISCOVERY_PAGES * PAGE_SIZE} pull requests`)
      return found
    },

    async metadata(ref: ChangeRequestRef): Promise<ChangeRequestMetadata> {
      requireScmCapability(adapter, 'metadata')
      const { owner, repo, number } = coordinates(ref)
      const pull = await api<{
        title: string; state: 'open' | 'closed'; draft?: boolean; updated_at: string; additions?: number; deletions?: number; user?: { login?: string }; labels?: Array<{ name?: string }>
        head: { sha: string; ref: string; repo?: { full_name?: string } }; base: { sha: string; ref: string; repo?: { full_name?: string } }
      }>(`/repos/${owner}/${repo}/pulls/${number}`)
      return ChangeRequestMetadataSchema.parse({
        ref, title: pull.title, state: pull.state, author: pull.user?.login ?? 'unknown', sourceRevision: pull.head.sha,
        targetRevision: pull.base.sha, sourceBranch: pull.head.ref, targetBranch: pull.base.ref,
        additions: pull.additions ?? 0, deletions: pull.deletions ?? 0,
        isDraft: Boolean(pull.draft), isFork: pull.head.repo?.full_name !== undefined && pull.head.repo.full_name !== pull.base.repo?.full_name,
        labels: (pull.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)), updatedAt: pull.updated_at,
      })
    },

    async diff(ref: ChangeRequestRef, baselineRevision?: string): Promise<ChangeRequestDiff> {
      requireScmCapability(adapter, 'diff')
      const { owner, repo, number } = coordinates(ref)
      const pull = await api<{ head: { sha: string }; base?: { sha?: string } }>(`/repos/${owner}/${repo}/pulls/${number}`)
      const files: Array<{ filename: string; previous_filename?: string; patch?: string; status: string }> = []
      let complete = true
      if (baselineRevision) {
        const comparison = await api<{ files?: typeof files }>(`/repos/${owner}/${repo}/compare/${baselineRevision}...${pull.head.sha}`)
        const batch = comparison.files ?? []
        complete = batch.length <= MAX_FILES
        files.push(...batch.slice(0, MAX_FILES))
      } else {
        const { items: batch, truncated } = await github.list<typeof files[number]>(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=${PAGE_SIZE}`, Math.ceil(MAX_FILES / PAGE_SIZE))
        files.push(...batch.slice(0, MAX_FILES))
        if (truncated || batch.length >= MAX_FILES) complete = false
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
      const endpoint = `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${revision}`
      const read = () => api<{ content: string; encoding: string; download_url?: string }>(endpoint)
      // GitHub can briefly return 404 for a file present at an immutable revision.
      // Retry exactly once at the same SHA; never substitute another revision.
      const content = await read().catch((error: unknown) => {
        if (!(error instanceof Error) || !/→ 404:/.test(error.message)) throw error
        return read()
      })
      if (content.encoding !== 'none') {
        const decoded = Buffer.from(content.content, content.encoding as BufferEncoding)
        return ScmFileContentSchema.parse({ content: decoded.byteLength <= maxBytes ? decoded.toString('utf8') : '', truncated: decoded.byteLength > maxBytes })
      }
      if (!content.download_url) throw new Error(`GitHub contents response has no download URL for ${path}`)
      const url = new URL(content.download_url)
      if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com') throw new Error(`GitHub contents response has an unsafe download URL for ${path}`)
      const rawClient = createGithubApiClient({ token: options.token, fetch: fetcher, baseUrl: url.origin })
      const response = await rawClient.request(url.toString(), { accept: 'application/vnd.github.raw', authenticated: false })
      try { return ScmFileContentSchema.parse({ content: await readGithubResponseText(response, maxBytes), truncated: false }) }
      catch (error) {
        if (!(error instanceof GithubResponseLimitError)) throw error
        return ScmFileContentSchema.parse({ content: '', truncated: true })
      }
    },

    async reviewState(ref: ChangeRequestRef, fingerprint: string): Promise<ScmReviewState> {
      requireScmCapability(adapter, 'review-state')
      const { owner, repo, number } = coordinates(ref)
      const state = await getGithubReviewState({ owner, repo, number, token: options.token, fingerprint, fetcher, channel: options.reviewStateChannel })
      return ScmReviewStateSchema.parse({ headRevision: state.sha, fingerprint, alreadyPublished: state.alreadyReviewed, scope: state.scope, baselineRevision: state.baselineSha ?? null })
    },

    async publishReview(ref: ChangeRequestRef, input: ScmReviewPublication): Promise<ScmPublicationReceipt> {
      requireScmCapability(adapter, 'publish-review')
      const review = ScmReviewPublicationSchema.parse(input)
      const { owner, repo, number } = coordinates(ref)
      const marker = review.fingerprint ? reviewMarker(review.headRevision, review.fingerprint) : undefined
      const body = `${marker ? `${marker}\n` : ''}${review.summary}`
      const publish = async (method: 'POST' | 'PATCH', path: string, payload: unknown): Promise<{ id?: number; html_url?: string }> => {
        try { return await mutate(method, path, payload) }
        catch (error) {
          // A failed acknowledgement is not proof that GitHub rejected the write.
          // Reconcile once by exact marker and body; never blindly repeat a POST.
          if (marker) {
            try {
              const history = review.channel === 'summary'
                ? await githubIssueComments(options.token, owner, repo, number, fetcher)
                : await githubPullReviews(options.token, owner, repo, number, fetcher)
              if (!history.truncated) {
                const items = 'comments' in history ? history.comments : history.reviews
                const existing = items.find(item => item.id !== undefined && item.body === body)
                if (existing?.id !== undefined) return { id: existing.id }
              }
            } catch { /* Preserve the original failure when delivery cannot be proven. */ }
          }
          throw error
        }
      }
      if (review.channel === 'summary') {
        if (!marker) {
          const posted = await publish('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })
          return ScmPublicationReceiptSchema.parse({ id: String(posted.id ?? 'summary'), ...(posted.html_url ? { url: posted.html_url } : {}) })
        }
        const history = await githubIssueComments(options.token, owner, repo, number, fetcher)
        if (history.truncated) throw new Error('GitHub review comment history is too large to update safely')
        const existing = history.comments.find((comment) => comment.id !== undefined && comment.body?.includes(marker))
        if (existing?.id !== undefined) {
          if (existing.body !== body) await publish('PATCH', `/repos/${owner}/${repo}/issues/comments/${existing.id}`, { body })
          return ScmPublicationReceiptSchema.parse({ id: String(existing.id) })
        }
        const posted = await publish('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })
        return ScmPublicationReceiptSchema.parse({ id: String(posted.id ?? 'summary'), ...(posted.html_url ? { url: posted.html_url } : {}) })
      }
      const payload = { body, commit_id: review.headRevision, ...(review.annotations.length ? { comments: review.annotations.map((annotation) => ({ path: annotation.path, line: annotation.endLine ?? annotation.line, body: annotation.body })) } : {}) }
      if (marker) {
        const history = await githubPullReviews(options.token, owner, repo, number, fetcher)
        if (history.truncated) throw new Error('GitHub review history is too large to update safely')
        const existing = history.reviews.find((item) => item.id !== undefined && item.body?.includes(marker))
        if (existing?.id !== undefined) return ScmPublicationReceiptSchema.parse({ id: String(existing.id), ...(existing.html_url ? { url: existing.html_url } : {}) })
      }
      const event = review.verdict === 'REQUEST_CHANGES' ? 'REQUEST_CHANGES' : 'COMMENT'
      let posted: { id?: number; html_url?: string }
      try { posted = await publish('POST', `/repos/${owner}/${repo}/pulls/${number}/reviews`, { event, ...payload }) }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('422')) throw error
        posted = await publish('POST', `/repos/${owner}/${repo}/pulls/${number}/reviews`, { event: 'COMMENT', ...payload })
      }
      return ScmPublicationReceiptSchema.parse({ id: String(posted.id ?? 'review'), ...(posted.html_url ? { url: posted.html_url } : {}) })
    },

    async mergeReadiness(ref: ChangeRequestRef, inputPolicy?: ScmCheckPolicy): Promise<ScmMergeReadiness> {
      requireScmCapability(adapter, 'merge-readiness')
      const policy = ScmCheckPolicySchema.parse(inputPolicy ?? {})
      const { owner, repo, number } = coordinates(ref)
      const pull = await api<{ draft?: boolean; mergeable?: boolean | null; mergeable_state?: string; head: { sha: string } }>(`/repos/${owner}/${repo}/pulls/${number}`)
      const checks = await github.listObject<{ total_count?: number; check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }>; [key: string]: unknown }>(`/repos/${owner}/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`, 'check_runs')
      const statuses = await github.listObject<{ state?: string; total_count?: number; statuses?: unknown[]; [key: string]: unknown }>(`/repos/${owner}/${repo}/commits/${pull.head.sha}/status?per_page=100`, 'statuses')
      const blockers: string[] = []
      const reviewHistory = await githubPullReviews(options.token, owner, repo, number, fetcher)
      if (reviewHistory.truncated) blockers.push('review history exceeds bounded readiness response')
      const decisions = new Map<string, string>()
      for (const review of reviewHistory.reviews) {
        if (!review.state) { blockers.push('review readiness response is incomplete'); continue }
        if (!['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)) continue
        if (!review.user?.login) { blockers.push('review decision has no author'); continue }
        decisions.set(review.user.login, review.state)
      }
      for (const [author, decision] of decisions) if (decision === 'CHANGES_REQUESTED') blockers.push(`changes requested by ${author}`)
      if (pull.draft) blockers.push('change request is draft')
      if (pull.mergeable !== true) blockers.push(`mergeable=${String(pull.mergeable)}`)
      if (!['clean', 'has_hooks'].includes(pull.mergeable_state ?? 'unknown')) blockers.push(`merge state=${pull.mergeable_state ?? 'unknown'}`)
      if (policy.mode === 'disabled') blockers.push('check policy=disabled')
      if (!Array.isArray(checks.check_runs) || !Number.isSafeInteger(checks.total_count)) blockers.push('check-run readiness response is incomplete')
      if ((checks.total_count ?? 0) > (checks.check_runs?.length ?? 0)) blockers.push('check runs exceed bounded readiness response')
      const reportedChecks = checks.check_runs ?? []
      if (policy.mode === 'required' && reportedChecks.length === 0) blockers.push('required check policy has no reported checks')
      const checksToValidate = policy.mode === 'named'
        ? reportedChecks.filter((check) => policy.names.includes(check.name ?? ''))
        : reportedChecks
      if (policy.mode === 'named') {
        for (const name of policy.names) if (!reportedChecks.some((check) => check.name === name)) blockers.push(`required check ${name}=missing`)
      }
      for (const check of checksToValidate) {
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
