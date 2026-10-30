/**
 * Provider-free scoring for the reviewer benchmark: the same labelled PR set is run through two
 * reviewers (the incumbent line reviewer and this one) and compared on real bugs found, false
 * positives, cost in US$ and latency. `scripts/run-reviewer-benchmark.mjs` does the execution.
 */
export const MIN_BENCHMARK_PRS = 30
export const MAX_COST_RATIO = 1.2

export interface KnownBug {
  file: string
  line: number
  lineTolerance?: number
  /** Case-insensitive substrings; when present, the finding title must include at least one. */
  titleIncludes?: string[]
  note: string
}

export interface BenchmarkPr {
  id: string
  repository: string
  number: number
  /** `buggy`: review findings became fixes (see `bugs`). `clean`: merged with no real defect. */
  label: 'buggy' | 'clean'
  bugs: KnownBug[]
}

export interface BenchmarkDataset { version: 1; prs: BenchmarkPr[] }

export interface ReviewerFinding { file: string; line: number; title: string }

export interface ReviewerRun {
  findings: ReviewerFinding[]
  costUsd: number
  latencyMs: number
  /** Set when the reviewer crashed or produced unusable output for this PR. */
  error?: string
}

export interface PrScore { id: string; bugsFound: number; bugsKnown: number; falsePositives: number; costUsd: number; latencyMs: number; error?: string }

export interface ReviewerSummary {
  name: string
  bugsFound: number
  bugsKnown: number
  falsePositives: number
  costUsd: number
  meanLatencyMs: number
  erroredPrs: number
  perPr: PrScore[]
}

export type BenchmarkDecision = 'PASS' | 'FAIL' | 'BLOCKED'

export interface BenchmarkReport {
  decision: BenchmarkDecision
  reasons: string[]
  incumbent: ReviewerSummary
  candidate: ReviewerSummary
}

export function parseBenchmarkDataset(value: unknown): BenchmarkDataset {
  const input = value as { version?: unknown; prs?: unknown }
  if (!input || input.version !== 1 || !Array.isArray(input.prs)) throw new Error('benchmark dataset must be { version: 1, prs: [] }')
  const seen = new Set<string>()
  const prs = input.prs.map((raw: any): BenchmarkPr => {
    const { id, repository, number, label, bugs } = raw ?? {}
    if (typeof id !== 'string' || !id || seen.has(id)) throw new Error(`benchmark PR id is missing or duplicated: ${String(id)}`)
    seen.add(id)
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`${id}: repository must be owner/repo`)
    if (!Number.isInteger(number) || number < 1) throw new Error(`${id}: number must be a positive integer`)
    if (label !== 'buggy' && label !== 'clean') throw new Error(`${id}: label must be buggy or clean`)
    if (!Array.isArray(bugs)) throw new Error(`${id}: bugs must be an array`)
    if (label === 'clean' && bugs.length) throw new Error(`${id}: a clean PR cannot list known bugs`)
    if (label === 'buggy' && !bugs.length) throw new Error(`${id}: a buggy PR needs at least one known bug`)
    for (const bug of bugs) {
      if (typeof bug?.file !== 'string' || !Number.isInteger(bug.line) || typeof bug.note !== 'string' || !bug.note) throw new Error(`${id}: each bug needs file, integer line and note`)
    }
    return { id, repository, number, label, bugs }
  })
  return { version: 1, prs }
}

export function bugMatches(bug: KnownBug, finding: ReviewerFinding): boolean {
  if (finding.file !== bug.file || Math.abs(finding.line - bug.line) > (bug.lineTolerance ?? 3)) return false
  if (!bug.titleIncludes?.length) return true
  const title = finding.title.toLowerCase()
  return bug.titleIncludes.some((needle) => title.includes(needle.toLowerCase()))
}

export function scorePr(pr: BenchmarkPr, run: ReviewerRun): PrScore {
  const found = new Set<number>()
  let falsePositives = 0
  for (const finding of run.findings) {
    const index = pr.bugs.findIndex((bug) => bugMatches(bug, finding))
    if (index === -1) falsePositives++
    else found.add(index)
  }
  return { id: pr.id, bugsFound: found.size, bugsKnown: pr.bugs.length, falsePositives, costUsd: run.costUsd, latencyMs: run.latencyMs, ...(run.error ? { error: run.error } : {}) }
}

export function summarizeReviewer(name: string, dataset: BenchmarkDataset, runs: Record<string, ReviewerRun>): ReviewerSummary {
  const perPr = dataset.prs.map((pr) => scorePr(pr, runs[pr.id] ?? { findings: [], costUsd: 0, latencyMs: 0, error: 'no run recorded' }))
  const sum = (pick: (score: PrScore) => number) => perPr.reduce((total, score) => total + pick(score), 0)
  return {
    name,
    bugsFound: sum((s) => s.bugsFound),
    bugsKnown: sum((s) => s.bugsKnown),
    falsePositives: sum((s) => s.falsePositives),
    costUsd: sum((s) => s.costUsd),
    meanLatencyMs: perPr.length ? Math.round(sum((s) => s.latencyMs) / perPr.length) : 0,
    erroredPrs: perPr.filter((s) => s.error).length,
    perPr,
  }
}

/** Entry criterion: at least as many real bugs, strictly fewer false positives, cost at most 20% higher. */
export function evaluateBenchmark(dataset: BenchmarkDataset, incumbentRuns: Record<string, ReviewerRun>, candidateRuns: Record<string, ReviewerRun>): BenchmarkReport {
  const incumbent = summarizeReviewer('incumbent', dataset, incumbentRuns)
  const candidate = summarizeReviewer('code-review', dataset, candidateRuns)
  const blocked: string[] = []
  if (dataset.prs.length < MIN_BENCHMARK_PRS) blocked.push(`dataset has ${dataset.prs.length} PRs; at least ${MIN_BENCHMARK_PRS} are required`)
  if (!dataset.prs.some((pr) => pr.label === 'buggy')) blocked.push('dataset has no buggy PRs')
  if (!dataset.prs.some((pr) => pr.label === 'clean')) blocked.push('dataset has no clean PRs')
  for (const side of [incumbent, candidate]) if (side.erroredPrs) blocked.push(`${side.name} errored on ${side.erroredPrs} PR(s); rerun before comparing`)
  if (blocked.length) return { decision: 'BLOCKED', reasons: blocked, incumbent, candidate }
  const failures: string[] = []
  if (candidate.bugsFound < incumbent.bugsFound) failures.push(`bugs found ${candidate.bugsFound} < incumbent ${incumbent.bugsFound}`)
  if (candidate.falsePositives >= incumbent.falsePositives) failures.push(`false positives ${candidate.falsePositives} are not fewer than incumbent ${incumbent.falsePositives}`)
  if (candidate.costUsd > incumbent.costUsd * MAX_COST_RATIO) failures.push(`cost $${candidate.costUsd.toFixed(2)} exceeds ${MAX_COST_RATIO}x incumbent $${incumbent.costUsd.toFixed(2)}`)
  return { decision: failures.length ? 'FAIL' : 'PASS', reasons: failures, incumbent, candidate }
}

export function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const { incumbent, candidate } = report
  const lines = [
    `# Reviewer benchmark: ${report.decision}`,
    '',
    ...report.reasons.map((reason) => `- ${reason}`),
    '',
    '| Reviewer | Bugs found | False positives | Cost (US$) | Mean latency (ms) | Errored PRs |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[incumbent, candidate].map((s) => `| ${s.name} | ${s.bugsFound}/${s.bugsKnown} | ${s.falsePositives} | ${s.costUsd.toFixed(2)} | ${s.meanLatencyMs} | ${s.erroredPrs} |`),
    '',
    '## Per PR',
    '',
    '| PR | Reviewer | Bugs | False positives | Cost (US$) | Latency (ms) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[incumbent, candidate].flatMap((s) => s.perPr.map((p) => `| ${p.id} | ${s.name} | ${p.bugsFound}/${p.bugsKnown} | ${p.falsePositives} | ${p.costUsd.toFixed(2)} | ${p.latencyMs}${p.error ? ' (error)' : ''} |`)),
  ]
  return `${lines.join('\n')}\n`
}
