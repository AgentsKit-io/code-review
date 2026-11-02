/**
 * Provider-free scoring for the reviewer benchmark: the same labelled PR set is run through two
 * reviewers (the incumbent line reviewer and this one) and compared on real bugs found, false
 * positives, tokens, cost in US$ (one price table for both) and latency. `scripts/run-reviewer-benchmark.mjs` does the execution.
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
  /** The PR/commit that fixed the defect: the evidence that the finding was real. */
  fix?: { pr: number; commit: string }
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

/** One price table, versioned in `quality/benchmark/prices.json`, applied to BOTH reviewers. */
export interface PriceTable {
  version: 1
  /** Date the rates were taken from the provider's public price list. */
  effectiveDate: string
  models: Record<string, { inputUsdPerMtok: number; outputUsdPerMtok: number }>
}

export function parsePriceTable(value: unknown): PriceTable {
  const input = value as { version?: unknown; effectiveDate?: unknown; models?: unknown }
  if (!input || input.version !== 1 || typeof input.effectiveDate !== 'string' || !input.models || typeof input.models !== 'object') throw new Error('price table must be { version: 1, effectiveDate, models: {} }')
  const models: PriceTable['models'] = {}
  for (const [model, rate] of Object.entries(input.models as Record<string, any>)) {
    const { inputUsdPerMtok, outputUsdPerMtok } = rate ?? {}
    if (![inputUsdPerMtok, outputUsdPerMtok].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) throw new Error(`${model}: rates must be positive numbers`)
    models[model] = { inputUsdPerMtok, outputUsdPerMtok }
  }
  if (!Object.keys(models).length) throw new Error('price table has no models')
  return { version: 1, effectiveDate: input.effectiveDate, models }
}

/** Cost in US$ from the tokens a reviewer reported; `undefined` when tokens or the model's price are missing (never a silent 0). */
export function priceRun(prices: PriceTable, run: Pick<ReviewerRun, 'model' | 'inputTokens' | 'outputTokens'>): number | undefined {
  const rate = run.model ? prices.models[run.model] : undefined
  if (!rate || !Number.isFinite(run.inputTokens) || !Number.isFinite(run.outputTokens)) return undefined
  const cost = (run.inputTokens! / 1e6) * rate.inputUsdPerMtok + (run.outputTokens! / 1e6) * rate.outputUsdPerMtok
  return cost > 0 ? cost : undefined
}

export interface ReviewerRun {
  findings: ReviewerFinding[]
  /** Tokens the review used, as reported by the provider; cost is derived from them with the shared price table. */
  inputTokens?: number
  outputTokens?: number
  /** Model id, a key of the price table. */
  model?: string
  latencyMs: number
  /** Set when the reviewer crashed or produced unusable output for this PR. */
  error?: string
}

export interface PrScore { id: string; bugsFound: number; bugsKnown: number; falsePositives: number; inputTokens: number; outputTokens: number; costUsd: number; unpriced?: boolean; latencyMs: number; error?: string }

export interface ReviewerSummary {
  name: string
  bugsFound: number
  bugsKnown: number
  falsePositives: number
  inputTokens: number
  outputTokens: number
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
  priceTableDate?: string
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
      if (bug.fix !== undefined && (!Number.isInteger(bug.fix.pr) || !/^[0-9a-f]{40}$/.test(bug.fix.commit ?? ''))) throw new Error(`${id}: bug.fix needs an integer pr and a 40-hex commit`)
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

export function scorePr(pr: BenchmarkPr, run: ReviewerRun, prices: PriceTable): PrScore {
  const found = new Set<number>()
  let falsePositives = 0
  for (const finding of run.findings) {
    const index = pr.bugs.findIndex((bug) => bugMatches(bug, finding))
    if (index === -1) falsePositives++
    else found.add(index)
  }
  const costUsd = priceRun(prices, run)
  return {
    id: pr.id, bugsFound: found.size, bugsKnown: pr.bugs.length, falsePositives,
    inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0, costUsd: costUsd ?? 0, ...(costUsd === undefined ? { unpriced: true } : {}),
    latencyMs: run.latencyMs, ...(run.error ? { error: run.error } : {}),
  }
}

export function summarizeReviewer(name: string, dataset: BenchmarkDataset, runs: Record<string, ReviewerRun>, prices: PriceTable): ReviewerSummary {
  const perPr = dataset.prs.map((pr) => scorePr(pr, runs[pr.id] ?? { findings: [], latencyMs: 0, error: 'no run recorded' }, prices))
  const sum = (pick: (score: PrScore) => number) => perPr.reduce((total, score) => total + pick(score), 0)
  return {
    name,
    bugsFound: sum((s) => s.bugsFound),
    bugsKnown: sum((s) => s.bugsKnown),
    falsePositives: sum((s) => s.falsePositives),
    inputTokens: sum((s) => s.inputTokens),
    outputTokens: sum((s) => s.outputTokens),
    costUsd: sum((s) => s.costUsd),
    meanLatencyMs: perPr.length ? Math.round(sum((s) => s.latencyMs) / perPr.length) : 0,
    erroredPrs: perPr.filter((s) => s.error).length,
    perPr,
  }
}

/** Entry criterion: at least as many real bugs, strictly fewer false positives, cost at most 20% higher. */
export function evaluateBenchmark(dataset: BenchmarkDataset, incumbentRuns: Record<string, ReviewerRun>, candidateRuns: Record<string, ReviewerRun>, prices: PriceTable): BenchmarkReport {
  const incumbent = summarizeReviewer('incumbent', dataset, incumbentRuns, prices)
  const candidate = summarizeReviewer('code-review', dataset, candidateRuns, prices)
  const blocked: string[] = []
  if (dataset.prs.length < MIN_BENCHMARK_PRS) blocked.push(`dataset has ${dataset.prs.length} PRs; at least ${MIN_BENCHMARK_PRS} are required`)
  if (!dataset.prs.some((pr) => pr.label === 'buggy')) blocked.push('dataset has no buggy PRs')
  if (!dataset.prs.some((pr) => pr.label === 'clean')) blocked.push('dataset has no clean PRs')
  for (const side of [incumbent, candidate]) if (side.erroredPrs) blocked.push(`${side.name} errored on ${side.erroredPrs} PR(s); rerun before comparing`)
  for (const side of [incumbent, candidate]) {
    const unpriced = side.perPr.filter((p) => !p.error && p.unpriced).length
    if (unpriced) blocked.push(`${side.name} has ${unpriced} completed PR(s) without measured cost (tokens or a price-table model missing); cost cannot be zero`)
  }
  const meta = { priceTableDate: prices.effectiveDate }
  if (blocked.length) return { decision: 'BLOCKED', reasons: blocked, incumbent, candidate, ...meta }
  const failures: string[] = []
  if (candidate.bugsFound < incumbent.bugsFound) failures.push(`bugs found ${candidate.bugsFound} < incumbent ${incumbent.bugsFound}`)
  if (candidate.falsePositives >= incumbent.falsePositives) failures.push(`false positives ${candidate.falsePositives} are not fewer than incumbent ${incumbent.falsePositives}`)
  if (candidate.costUsd > incumbent.costUsd * MAX_COST_RATIO) failures.push(`cost $${candidate.costUsd.toFixed(2)} exceeds ${MAX_COST_RATIO}x incumbent $${incumbent.costUsd.toFixed(2)}`)
  return { decision: failures.length ? 'FAIL' : 'PASS', reasons: failures, incumbent, candidate, ...meta }
}

const cell = (p: PrScore | undefined) => (p ? `${p.error ? 'error' : `${p.bugsFound}/${p.bugsKnown}`} | ${p.error ? '-' : p.falsePositives}` : '- | -')

const costCells = (p: PrScore | undefined) => (!p || p.error ? '- | -' : p.unpriced ? 'not measured | not measured' : `${p.inputTokens}/${p.outputTokens} | ${p.costUsd.toFixed(4)}`)

/** Requirement RF-02 (`mvp:RF-02`): real bugs and false positives per PR and in total, both reviewers, one counting rule. */
export function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const { incumbent, candidate } = report
  const lines = [
    `# Reviewer benchmark: ${report.decision}`,
    '',
    'Requirement `mvp:RF-02`: real bugs found and false positives of both reviewers, per PR and in total.',
    '',
    ...report.reasons.map((reason) => `- ${reason}`),
    '',
    '## Counting rule',
    '',
    'Both reviewers run over the same labelled PRs (`quality/benchmark/prs.json`) and are scored by the same function (`scorePr` in `src/reviewer-benchmark.ts`):',
    '',
    '- A **real bug** is a known bug (a defect later fixed by a fix PR) matched by at least one finding on the same file within the line tolerance (default 3 lines); each known bug counts once.',
    '- A **false positive** is any finding that matches no known bug, including every finding on a clean PR.',
    '- A PR where the reviewer errored shows `error` and is not counted; any error makes the decision `BLOCKED`.',
    '',
    '## Totals',
    '',
    '| Reviewer | Bugs found | False positives | Input tokens | Output tokens | Cost (US$) | Mean latency (ms) | Errored PRs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...[incumbent, candidate].map((s) => `| ${s.name} | ${s.bugsFound}/${s.bugsKnown} | ${s.falsePositives} | ${s.inputTokens} | ${s.outputTokens} | ${s.costUsd.toFixed(2)} | ${s.meanLatencyMs} | ${s.erroredPrs} |`),
    '',
    '## Per PR',
    '',
    '| PR | incumbent bugs | incumbent false positives | code-review bugs | code-review false positives |',
    '| --- | --- | --- | --- | --- |',
    ...incumbent.perPr.map((p) => `| ${p.id} | ${cell(p)} | ${cell(candidate.perPr.find((c) => c.id === p.id))} |`),
    `| **Total** | **${incumbent.bugsFound}/${incumbent.bugsKnown}** | **${incumbent.falsePositives}** | **${candidate.bugsFound}/${candidate.bugsKnown}** | **${candidate.falsePositives}** |`,
    '',
    '## Cost per PR (`mvp:RF-04`)',
    '',
    `Cost is computed from the input and output tokens each reviewer reported, with the same per-model price table for both (\`quality/benchmark/prices.json\`${report.priceTableDate ? `, rates of ${report.priceTableDate}` : ''}). A completed PR without tokens or without a priced model makes the report \`BLOCKED\`; it is never shown as zero.`,
    '',
    '| PR | incumbent in/out tokens | incumbent US$ | code-review in/out tokens | code-review US$ |',
    '| --- | --- | --- | --- | --- |',
    ...incumbent.perPr.map((p) => `| ${p.id} | ${costCells(p)} | ${costCells(candidate.perPr.find((c) => c.id === p.id))} |`),
    `| **Total** | **${incumbent.inputTokens}/${incumbent.outputTokens}** | **${incumbent.costUsd.toFixed(4)}** | **${candidate.inputTokens}/${candidate.outputTokens}** | **${candidate.costUsd.toFixed(4)}** |`,
    '',
    '## Reproduce',
    '',
    '```bash',
    'npm ci && npm run build',
    'export GITHUB_TOKEN=... AGENTSKIT_SHADOW_PROVIDER=anthropic AGENTSKIT_SHADOW_MODEL=<model in prices.json>',
    'node scripts/run-reviewer-benchmark.mjs --incumbent-cmd <line reviewer executable> \\',
    '  --candidate-cmd ./scripts/shadow-review.mjs --concurrency 6 \\',
    '  --output quality/benchmark/report.json --markdown docs/reviewer-benchmark-report.md',
    '```',
    '',
    'The incumbent command is run as `<executable> <owner/repo> <number>` and prints `{"findings":[{"file","line","title"}],"model","inputTokens","outputTokens"}`; see `docs/reviewer-benchmark.md`.',
  ]
  return `${lines.join('\n')}\n`
}
