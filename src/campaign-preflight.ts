import { z } from 'zod'
import { builtInLenses, createCodeReviewAgent } from '../agents/code-review/agent.js'
import { configFingerprint, ReviewConfigSchema, toReviewConfig, type ReviewProjectConfig } from './public-config.js'
import { resolveReviewConfig } from './review-config.js'
import { reviewPolicyFingerprint } from './review-policy.js'
import { planReviewBatches } from './batch-mode.js'
import type { DoctorReport } from './provider-registry.js'
import type { ChangeRequestMetadata, ChangeRequestRef, ScmAdapter } from './scm-contract.js'

const checkSchema = z.object({ id: z.string(), ok: z.boolean(), detail: z.string() }).strict()
const planSchema = z.object({
  files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
  estimatedProviderCalls: z.number().int().nonnegative(), maxCalls: z.number().int().positive(), changedFiles: z.array(z.string()), reviewableFiles: z.array(z.string()),
  unreviewed: z.array(z.object({ file: z.string(), reason: z.string() }).strict()),
}).strict()

export const CampaignPreflightEntrySchema = z.object({
  ref: z.object({ repository: z.string(), id: z.string() }).strict(),
  title: z.string().optional(), author: z.string().optional(), headRevision: z.string().optional(),
  status: z.enum(['ready', 'skipped', 'blocked']), reasons: z.array(z.string()),
  worktreeAllowed: z.boolean(), plan: planSchema.nullable(),
}).strict()

export const CampaignPreflightReportSchema = z.object({
  version: z.literal(1), repository: z.string().nullable(), configFingerprint: z.string().length(64).nullable(), generatedAt: z.string().datetime(),
  status: z.enum(['ready', 'blocked']), modelCalls: z.literal(0), worktreesCreated: z.literal(0),
  checks: z.array(checkSchema), pullRequests: z.array(CampaignPreflightEntrySchema),
}).strict()

export type CampaignPreflightEntry = z.infer<typeof CampaignPreflightEntrySchema>
export type CampaignPreflightReport = z.infer<typeof CampaignPreflightReportSchema>

export function blockedCampaignPreflightReport(input: { repository?: string; configFingerprint?: string; checks: Array<{ id: string; ok: boolean; detail: string }>; now?: () => Date }): CampaignPreflightReport {
  return CampaignPreflightReportSchema.parse({ version: 1, repository: input.repository ?? null, configFingerprint: input.configFingerprint ?? null, generatedAt: (input.now ?? (() => new Date()))().toISOString(), status: 'blocked', modelCalls: 0, worktreesCreated: 0, checks: input.checks, pullRequests: [] })
}

export async function preflightCampaign(input: {
  config: ReviewProjectConfig
  adapter: ScmAdapter
  providerHealth: Pick<DoctorReport, 'ok' | 'provider' | 'checks'>
  now?: () => Date
  signal?: AbortSignal
  refs?: readonly ChangeRequestRef[]
}): Promise<CampaignPreflightReport> {
  input.signal?.throwIfAborted()
  const config = ReviewConfigSchema.parse(input.config)
  const fingerprint = configFingerprint(config)
  const checks = [
    { id: 'config.valid', ok: true, detail: 'project configuration accepted' },
    { id: 'scm.provider', ok: config.target.provider === input.adapter.id, detail: `${config.target.provider}/${input.adapter.id}` },
    { id: 'provider.health', ok: input.providerHealth.ok, detail: `${input.providerHealth.provider}: ${input.providerHealth.checks.filter((check) => check.status === 'fail').map((check) => check.name).join(', ') || 'ready'}` },
    ...(['discovery', 'metadata', 'diff', 'file-content', 'review-state'] as const).map((capability) => ({ id: `scm.${capability}`, ok: input.adapter.capabilities[capability], detail: `${input.adapter.id} ${capability}` })),
  ]

  let refs: readonly ChangeRequestRef[] = []
  try { refs = input.refs ?? await input.adapter.discover({ repository: config.target.repository, state: 'open', authors: [], excludeAuthors: [], labels: [] }) }
  catch (error) { checks.push({ id: 'scm.discovery', ok: false, detail: error instanceof Error ? error.message : String(error) }) }
  const unique = new Map(refs.map((ref) => [`${ref.repository}#${ref.id}`, ref]))
  if (refs.some((ref) => ref.repository !== config.target.repository)) throw new Error('selected pull request is outside the configured repository')
  checks.push({ id: 'discovery.unique', ok: unique.size === refs.length, detail: `${unique.size}/${refs.length} unique change requests` })
  if (!refs.length && config.report.failOnEmptyReport) checks.push({ id: 'discovery.non-empty', ok: false, detail: 'no open change requests discovered' })

  const include = new Set((config.target.authors ?? []).map((author) => author.toLowerCase()))
  const exclude = new Set((config.target.excludeAuthors ?? []).map((author) => author.toLowerCase()))
  const resolved = resolveReviewConfig(toReviewConfig(config))
  const policyFingerprint = reviewPolicyFingerprint(resolved)
  const pullRequests: CampaignPreflightEntry[] = []
  for (const ref of [...unique.values()].sort((left, right) => Number(left.id) - Number(right.id) || left.id.localeCompare(right.id))) {
    input.signal?.throwIfAborted()
    let metadata: ChangeRequestMetadata
    try { metadata = await input.adapter.metadata(ref) }
    catch (error) {
      pullRequests.push({ ref, status: 'blocked', reasons: [`metadata: ${error instanceof Error ? error.message : String(error)}`], worktreeAllowed: false, plan: null })
      continue
    }
    const author = metadata.author.toLowerCase()
    const reasons = [
      ...(metadata.state !== 'open' ? ['change request is not open'] : []),
      ...(metadata.isDraft ? ['change request is draft'] : []),
      ...(metadata.isFork ? ['change request is from a fork'] : []),
      ...(metadata.targetBranch !== config.target.baseBranch ? [`target branch is ${metadata.targetBranch}, expected ${config.target.baseBranch}`] : []),
      ...(['dependabot[bot]', 'app/dependabot'].includes(author) ? ['author is Dependabot'] : []),
      ...(include.size && !include.has(author) ? ['author is not configured as eligible'] : []),
      ...(exclude.has(author) ? ['author is explicitly excluded'] : []),
    ]
    if (reasons.length) {
      pullRequests.push({ ref, title: metadata.title, author: metadata.author, headRevision: metadata.sourceRevision, status: 'skipped', reasons, worktreeAllowed: false, plan: null })
      continue
    }

    let alreadyPublished = false
    try {
      const reviewState = await input.adapter.reviewState(ref, policyFingerprint)
      if (reviewState.headRevision !== metadata.sourceRevision) reasons.push('head revision changed during review-state preflight')
      else alreadyPublished = reviewState.alreadyPublished
    }
    catch (error) { reasons.push(`review state: ${error instanceof Error ? error.message : String(error)}`) }
    if (alreadyPublished) {
      pullRequests.push({ ref, title: metadata.title, author: metadata.author, headRevision: metadata.sourceRevision, status: 'skipped', reasons: ['same head revision and policy were already reviewed'], worktreeAllowed: false, plan: null })
      continue
    }

    let plan: CampaignPreflightEntry['plan'] = null
    try {
      const diff = await input.adapter.diff(ref)
      if (!diff.complete) reasons.push('change-request diff is incomplete')
      if (diff.headRevision !== metadata.sourceRevision) reasons.push('head revision changed during preflight')
      const review = createCodeReviewAgent({
        source: { kind: 'scm', adapter: input.adapter, ref, diff, collectErrors: true, redact: true, limits: { maxFiles: 500, maxBytes: 25 * 1024 * 1024, maxFileBytes: 1024 * 1024 } },
        reporters: [], lenses: builtInLenses(Object.entries(resolved.lenses).filter(([, policy]) => policy.enabled).map(([key]) => key as Parameters<typeof builtInLenses>[0][number])),
        requiredLenses: Object.entries(resolved.lenses).filter(([, policy]) => policy.required).map(([key]) => key as Parameters<typeof builtInLenses>[0][number]),
        retries: resolved.retries, auditVotes: resolved.votes, profile: resolved.profile, batchLenses: resolved.batchLenses,
        thresholds: resolved.thresholds, budget: resolved.budget, context: resolved.context,
      })
      const planned = await review.plan()
      plan = { files: planned.files, bytes: planned.bytes, estimatedProviderCalls: planned.estimatedProviderCalls, maxCalls: planned.maxCalls, changedFiles: diff.files.map((file) => file.path).sort(), reviewableFiles: planned.reviewableFiles, unreviewed: planned.unreviewed }
      if (!planned.files) reasons.push('no reviewable changed files')
      if ((config.batches.requireCompleteCoverage || config.batches.failOnUnreviewableFiles) && planned.unreviewedFiles) reasons.push(`${planned.unreviewedFiles} changed file(s) are unreviewed`)
      reasons.push(...(config.batches.enabled
        ? (await planReviewBatches(planned.reviewableFiles, config.batches.size, (files, packs) => review.plan(files, packs))).overBudget
        : planned.overBudget))
    } catch (error) { reasons.push(`source plan: ${error instanceof Error ? error.message : String(error)}`) }
    const blocked = reasons.length > 0
    pullRequests.push({ ref, title: metadata.title, author: metadata.author, headRevision: metadata.sourceRevision, status: blocked ? 'blocked' : 'ready', reasons, worktreeAllowed: !blocked, plan })
  }

  const globallyReady = checks.every((check) => check.ok)
  return CampaignPreflightReportSchema.parse({
    version: 1, repository: config.target.repository, configFingerprint: fingerprint,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(), modelCalls: 0, worktreesCreated: 0,
    status: !globallyReady || pullRequests.some((pull) => pull.status === 'blocked') ? 'blocked' : 'ready',
    checks, pullRequests: pullRequests.map((pull) => ({ ...pull, worktreeAllowed: globallyReady && pull.status === 'ready' })),
  })
}
