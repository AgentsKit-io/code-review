/**
 * Provider-free report for the one-week shadow run: for each PR, what each reviewer found, which
 * findings became a fix or were a false alarm, and the tokens spent. Applies the same three criteria
 * as the reviewer benchmark (`reviewer-benchmark.ts`) to the week's totals. Real weekly data stays
 * outside this repository; `scripts/render-shadow-week-report.mjs` does the file handling.
 */
import { MAX_COST_RATIO } from './reviewer-benchmark.js'

export const MIN_SHADOW_DAYS = 7
export const MIN_SHADOW_REPOSITORIES = 2
export const MAX_SHADOW_REPOSITORIES = 3
export const SHADOW_REVIEWERS = ['incumbent', 'code-review'] as const
export type ShadowReviewerName = (typeof SHADOW_REVIEWERS)[number]
export type ShadowVerdict = 'fix' | 'false-alarm'

export interface ShadowFinding { title: string; verdict: ShadowVerdict }
export interface ShadowReviewerRun { findings: ShadowFinding[]; tokens: number }
export interface ShadowPr {
  id: string
  repository: string
  number: number
  /** Day the PR was reviewed, `YYYY-MM-DD`. */
  date: string
  reviewers: Record<ShadowReviewerName, ShadowReviewerRun>
}
export interface ShadowWeekData { version: 1; usdPerMtok: number; prs: ShadowPr[] }

export interface ShadowPrScore { id: string; reviewer: ShadowReviewerName; fixes: number; falseAlarms: number; tokens: number; costUsd: number }
export interface ShadowReviewerTotals { name: ShadowReviewerName; fixes: number; falseAlarms: number; tokens: number; costUsd: number }
export type ShadowDecision = 'PASS' | 'FAIL' | 'BLOCKED'
export interface ShadowWeekReport {
  decision: ShadowDecision
  reasons: string[]
  days: number
  repositories: string[]
  incumbent: ShadowReviewerTotals
  candidate: ShadowReviewerTotals
  perPr: ShadowPrScore[]
}

const DAY_MS = 86_400_000

export function parseShadowWeekData(value: unknown): ShadowWeekData {
  const input = value as { version?: unknown; usdPerMtok?: unknown; prs?: unknown }
  if (!input || input.version !== 1 || !Array.isArray(input.prs)) throw new Error('shadow week data must be { version: 1, usdPerMtok, prs: [] }')
  const usdPerMtok = input.usdPerMtok
  if (typeof usdPerMtok !== 'number' || !Number.isFinite(usdPerMtok) || usdPerMtok <= 0) throw new Error('usdPerMtok must be a positive number: both reviewers use the same price table')
  const seen = new Set<string>()
  const prs = input.prs.map((raw: any): ShadowPr => {
    const { id, repository, number, date, reviewers } = raw ?? {}
    if (typeof id !== 'string' || !id || seen.has(id)) throw new Error(`shadow PR id is missing or duplicated: ${String(id)}`)
    seen.add(id)
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`${id}: repository must be owner/repo`)
    if (!Number.isInteger(number) || number < 1) throw new Error(`${id}: number must be a positive integer`)
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`${id}: date must be YYYY-MM-DD`)
    const parsed = {} as Record<ShadowReviewerName, ShadowReviewerRun>
    for (const name of SHADOW_REVIEWERS) {
      const run = reviewers?.[name]
      if (!run || !Array.isArray(run.findings)) throw new Error(`${id}: reviewer ${name} needs findings and tokens`)
      if (!Number.isInteger(run.tokens) || run.tokens < 0) throw new Error(`${id}: ${name}.tokens must be a non-negative integer`)
      for (const finding of run.findings) {
        if (typeof finding?.title !== 'string' || !finding.title) throw new Error(`${id}: each ${name} finding needs a title`)
        if (finding.verdict !== 'fix' && finding.verdict !== 'false-alarm') throw new Error(`${id}: each ${name} finding must be classified as fix or false-alarm`)
      }
      parsed[name] = { findings: run.findings.map((f: ShadowFinding) => ({ title: f.title, verdict: f.verdict })), tokens: run.tokens }
    }
    return { id, repository, number, date, reviewers: parsed }
  })
  return { version: 1, usdPerMtok, prs }
}

function scoreRun(pr: ShadowPr, reviewer: ShadowReviewerName, usdPerMtok: number): ShadowPrScore {
  const { findings, tokens } = pr.reviewers[reviewer]
  const fixes = findings.filter((f) => f.verdict === 'fix').length
  return { id: pr.id, reviewer, fixes, falseAlarms: findings.length - fixes, tokens, costUsd: (tokens / 1e6) * usdPerMtok }
}

function totals(name: ShadowReviewerName, perPr: ShadowPrScore[]): ShadowReviewerTotals {
  const own = perPr.filter((s) => s.reviewer === name)
  const sum = (pick: (s: ShadowPrScore) => number) => own.reduce((total, s) => total + pick(s), 0)
  return { name, fixes: sum((s) => s.fixes), falseAlarms: sum((s) => s.falseAlarms), tokens: sum((s) => s.tokens), costUsd: sum((s) => s.costUsd) }
}

/** Same criteria as the benchmark: at least as many fixes, strictly fewer false alarms, cost at most 1.2x. */
export function evaluateShadowWeek(data: ShadowWeekData): ShadowWeekReport {
  const perPr = data.prs.flatMap((pr) => SHADOW_REVIEWERS.map((name) => scoreRun(pr, name, data.usdPerMtok)))
  const incumbent = totals('incumbent', perPr)
  const candidate = totals('code-review', perPr)
  const repositories = [...new Set(data.prs.map((pr) => pr.repository))].sort()
  const times = data.prs.map((pr) => Date.parse(pr.date))
  const days = times.length ? Math.round((Math.max(...times) - Math.min(...times)) / DAY_MS) + 1 : 0
  const blocked: string[] = []
  if (days < MIN_SHADOW_DAYS) blocked.push(`data covers ${days} day(s); at least ${MIN_SHADOW_DAYS} consecutive days are required`)
  if (repositories.length < MIN_SHADOW_REPOSITORIES || repositories.length > MAX_SHADOW_REPOSITORIES) blocked.push(`data covers ${repositories.length} repositories; the shadow week uses ${MIN_SHADOW_REPOSITORIES} or ${MAX_SHADOW_REPOSITORIES}`)
  const base = { days, repositories, incumbent, candidate, perPr }
  if (blocked.length) return { decision: 'BLOCKED', reasons: blocked, ...base }
  const failures: string[] = []
  if (candidate.fixes < incumbent.fixes) failures.push(`fixes ${candidate.fixes} < incumbent ${incumbent.fixes}`)
  if (candidate.falseAlarms >= incumbent.falseAlarms) failures.push(`false alarms ${candidate.falseAlarms} are not fewer than incumbent ${incumbent.falseAlarms}`)
  if (candidate.costUsd > incumbent.costUsd * MAX_COST_RATIO) failures.push(`cost $${candidate.costUsd.toFixed(2)} exceeds ${MAX_COST_RATIO}x incumbent $${incumbent.costUsd.toFixed(2)}`)
  return { decision: failures.length ? 'FAIL' : 'PASS', reasons: failures, ...base }
}

export function renderShadowWeekMarkdown(report: ShadowWeekReport): string {
  const { incumbent, candidate } = report
  const lines = [
    `# Shadow week: ${report.decision}`,
    '',
    `${report.days} day(s), ${report.repositories.length} repositories: ${report.repositories.join(', ')}`,
    '',
    ...report.reasons.map((reason) => `- ${reason}`),
    '',
    '| Reviewer | Fixes | False alarms | Tokens | Cost (US$) |',
    '| --- | --- | --- | --- | --- |',
    ...[incumbent, candidate].map((s) => `| ${s.name} | ${s.fixes} | ${s.falseAlarms} | ${s.tokens} | ${s.costUsd.toFixed(2)} |`),
    '',
    '## Per PR',
    '',
    '| PR | Reviewer | Fixes | False alarms | Tokens | Cost (US$) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.perPr.map((p) => `| ${p.id} | ${p.reviewer} | ${p.fixes} | ${p.falseAlarms} | ${p.tokens} | ${p.costUsd.toFixed(2)} |`),
  ]
  return `${lines.join('\n')}\n`
}
