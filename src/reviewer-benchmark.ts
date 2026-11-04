/**
 * Provider-free scoring for the reviewer benchmark: the same labelled PR set is run through two
 * reviewers (the incumbent line reviewer and this one) and compared on real bugs found, false
 * positives, tokens, cost in US$ (one price table for both) and latency. `scripts/run-reviewer-benchmark.mjs` does the execution.
 */
import { createHash } from 'node:crypto'

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
  /** Head commit of the PR that both reviewers are given (40 hex); the runner refuses to run if the PR head is anywhere else. */
  commit: string
  /** `buggy`: review findings became fixes (see `bugs`). `clean`: merged with no real defect. */
  label: 'buggy' | 'clean'
  bugs: KnownBug[]
}

export interface BenchmarkDataset { version: 1; prs: BenchmarkPr[] }

export interface ReviewerFinding { file: string; line: number; title: string }

/** Why a reviewer failed on a PR, readable without rerunning: exit code, stage and the last stderr lines (secrets removed). */
export interface ErrorDetail {
  exitCode?: number | string
  /** `pin-check` (PR head not the pinned commit), `review` (reviewer exited non-zero) or `parse-output` (output unusable). */
  stage: 'pin-check' | 'review' | 'parse-output'
  stderrTail: string[]
}

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
  errorDetail?: ErrorDetail
}

/** A finding classified against the known bugs of its PR. */
export interface ScoredFinding extends ReviewerFinding {
  verdict: 'real-bug' | 'false-positive'
  /** The known bug this finding matched (real bugs only). */
  matchedBug?: { file: string; line: number; note: string }
}

export interface PrScore {
  id: string
  bugsFound: number
  bugsKnown: number
  falsePositives: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  unpriced?: boolean
  latencyMs: number
  findings: ScoredFinding[]
  error?: string
  errorDetail?: ErrorDetail
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
]
const SECRET_ASSIGNMENT = /\b([A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|authorization)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi

function mdCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

/** Removes API keys, tokens and `NAME=value` secrets from text that is about to be stored in a report. */
export function redactSecrets(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out.replace(SECRET_ASSIGNMENT, '$1$2[redacted]')
}

/** Builds the stored failure cause: the last `maxLines` non-empty stderr lines, redacted and length-capped. */
export function describeFailure(stage: ErrorDetail['stage'], exitCode: number | string | null | undefined, stderr: string, maxLines = 5): ErrorDetail {
  const stderrTail = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-maxLines).map((l) => redactSecrets(l).slice(0, 300))
  return { ...(exitCode === undefined || exitCode === null ? {} : { exitCode }), stage, stderrTail }
}

export interface ReviewerSummary {
  name: string
  bugsFound: number
  bugsKnown: number
  falsePositives: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  meanLatencyMs: number
  /** Nearest-rank 90th percentile of the per-PR latency. */
  p90LatencyMs: number
  erroredPrs: number
  perPr: PrScore[]
}

export interface BenchmarkOptions {
  /** Time the line gives its review stage; when set, the candidate p90 latency must fit in it (RF-05). */
  stageTimeoutMs?: number
}

export type BenchmarkDecision = 'PASS' | 'FAIL' | 'BLOCKED'

/** Which labelled set a report was measured on. */
export interface BenchmarkSetInfo {
  path: string
  /** Dataset format version. */
  version: 1
  /** sha256 of the parsed set (ids, commits, labels, bugs): two reports with the same digest used the same set. */
  digest: string
  prs: number
  buggy: number
  clean: number
  repositories: string[]
  /** The commit each reviewer was given, per PR. */
  commits: { id: string; label: BenchmarkPr['label']; commit: string }[]
}

/** Which version of code-review produced the candidate side of a report. */
export interface BenchmarkRunInfo { codeReviewVersion: string; gitCommit?: string }

export interface BenchmarkReport {
  decision: BenchmarkDecision
  reasons: string[]
  /** Package version of code-review that was measured; the line may only pin this version. */
  candidateVersion?: string
  /** sha256 of the labelled dataset file that was run; a changed set needs a new measurement. */
  datasetSha256?: string
  set: BenchmarkSetInfo
  run?: BenchmarkRunInfo
  incumbent: ReviewerSummary
  candidate: ReviewerSummary
  priceTableDate?: string
}

export interface BenchmarkMeta { candidateVersion?: string; datasetSha256?: string }

export function parseBenchmarkDataset(value: unknown): BenchmarkDataset {
  const input = value as { version?: unknown; prs?: unknown }
  if (!input || input.version !== 1 || !Array.isArray(input.prs)) throw new Error('benchmark dataset must be { version: 1, prs: [] }')
  const seen = new Set<string>()
  const prs = input.prs.map((raw: any): BenchmarkPr => {
    const { id, repository, number, commit, label, bugs } = raw ?? {}
    if (typeof id !== 'string' || !id || seen.has(id)) throw new Error(`benchmark PR id is missing or duplicated: ${String(id)}`)
    seen.add(id)
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`${id}: repository must be owner/repo`)
    if (!Number.isInteger(number) || number < 1) throw new Error(`${id}: number must be a positive integer`)
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${id}: commit must be the 40-hex head commit the reviewers are given`)
    if (label !== 'buggy' && label !== 'clean') throw new Error(`${id}: label must be buggy or clean`)
    if (!Array.isArray(bugs)) throw new Error(`${id}: bugs must be an array`)
    if (label === 'clean' && bugs.length) throw new Error(`${id}: a clean PR cannot list known bugs`)
    if (label === 'buggy' && !bugs.length) throw new Error(`${id}: a buggy PR needs at least one known bug`)
    for (const bug of bugs) {
      if (typeof bug?.file !== 'string' || !Number.isInteger(bug.line) || typeof bug.note !== 'string' || !bug.note) throw new Error(`${id}: each bug needs file, integer line and note`)
      if (bug.fix !== undefined && (!Number.isInteger(bug.fix.pr) || !/^[0-9a-f]{40}$/.test(bug.fix.commit ?? ''))) throw new Error(`${id}: bug.fix needs an integer pr and a 40-hex commit`)
    }
    return { id, repository, number, commit, label, bugs }
  })
  return { version: 1, prs }
}

export function describeBenchmarkSet(dataset: BenchmarkDataset, path = 'quality/benchmark/prs.json'): BenchmarkSetInfo {
  return {
    path,
    version: dataset.version,
    digest: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
    prs: dataset.prs.length,
    buggy: dataset.prs.filter((pr) => pr.label === 'buggy').length,
    clean: dataset.prs.filter((pr) => pr.label === 'clean').length,
    repositories: [...new Set(dataset.prs.map((pr) => pr.repository))].sort(),
    commits: dataset.prs.map(({ id, label, commit }) => ({ id, label, commit })),
  }
}

/** Both reviewers must see the PR at its pinned commit: returns why a PR whose head is `head` cannot be reviewed, or undefined. */
export function pinnedCommitError(pr: BenchmarkPr, head: string | undefined): string | undefined {
  if (!head) return `could not read the head commit of ${pr.id}`
  return head === pr.commit ? undefined : `${pr.id} head is ${head}, not the pinned ${pr.commit}`
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
  const findings: ScoredFinding[] = []
  for (const { file, line, title } of run.findings) {
    const finding = { file, line, title }
    const index = pr.bugs.findIndex((bug) => bugMatches(bug, finding))
    if (index === -1) {
      falsePositives++
      findings.push({ ...finding, verdict: 'false-positive' })
    } else {
      found.add(index)
      const { file: bugFile, line: bugLine, note } = pr.bugs[index]
      findings.push({ ...finding, verdict: 'real-bug', matchedBug: { file: bugFile, line: bugLine, note } })
    }
  }
  const costUsd = priceRun(prices, run)
  return {
    id: pr.id, bugsFound: found.size, bugsKnown: pr.bugs.length, falsePositives,
    inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0, costUsd: costUsd ?? 0, ...(costUsd === undefined ? { unpriced: true } : {}),
    latencyMs: run.latencyMs, findings, ...(run.error ? { error: run.error } : {}), ...(run.errorDetail ? { errorDetail: run.errorDetail } : {}),
  }
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
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
    p90LatencyMs: percentile(perPr.map((s) => s.latencyMs), 90),
    erroredPrs: perPr.filter((s) => s.error).length,
    perPr,
  }
}

/** Entry criterion: at least as many real bugs, strictly fewer false positives, cost at most 20% higher. */
export function evaluateBenchmark(dataset: BenchmarkDataset, incumbentRuns: Record<string, ReviewerRun>, candidateRuns: Record<string, ReviewerRun>, prices: PriceTable, options: BenchmarkOptions & BenchmarkMeta & { setPath?: string; run?: BenchmarkRunInfo } = {}): BenchmarkReport {
  const base = {
    ...(options.candidateVersion ? { candidateVersion: options.candidateVersion } : {}),
    ...(options.datasetSha256 ? { datasetSha256: options.datasetSha256 } : {}),
    set: describeBenchmarkSet(dataset, options.setPath),
    ...(options.run ? { run: options.run } : {}),
    priceTableDate: prices.effectiveDate,
  }
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
  if (blocked.length) return { decision: 'BLOCKED', reasons: blocked, ...base, incumbent, candidate }
  const failures: string[] = []
  if (candidate.bugsFound < incumbent.bugsFound) failures.push(`bugs found ${candidate.bugsFound} < incumbent ${incumbent.bugsFound}`)
  if (candidate.falsePositives >= incumbent.falsePositives) failures.push(`false positives ${candidate.falsePositives} are not fewer than incumbent ${incumbent.falsePositives}`)
  if (candidate.costUsd > incumbent.costUsd * MAX_COST_RATIO) failures.push(`cost $${candidate.costUsd.toFixed(2)} exceeds ${MAX_COST_RATIO}x incumbent $${incumbent.costUsd.toFixed(2)}`)
  if (options.stageTimeoutMs !== undefined && candidate.p90LatencyMs > options.stageTimeoutMs) failures.push(`p90 latency ${candidate.p90LatencyMs}ms exceeds the review-stage time ${options.stageTimeoutMs}ms`)
  return { decision: failures.length ? 'FAIL' : 'PASS', reasons: failures, ...base, incumbent, candidate }
}

/** Groups the false positives of one reviewer by finding title (the rule that produced them), most frequent first. */
export function falsePositiveCategories(summary: ReviewerSummary): { category: string; count: number; examples: string[] }[] {
  const groups = new Map<string, { count: number; examples: string[] }>()
  for (const pr of summary.perPr) {
    for (const f of pr.findings ?? []) {
      if (f.verdict !== 'false-positive') continue
      const category = f.title.trim().toLowerCase().replace(/\s+/g, ' ') || '(untitled)'
      const group = groups.get(category) ?? { count: 0, examples: [] }
      group.count++
      if (group.examples.length < 3) group.examples.push(`${pr.id} ${f.file}:${f.line}`)
      groups.set(category, group)
    }
  }
  return [...groups].map(([category, g]) => ({ category, ...g })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

const cell = (p: PrScore | undefined) => (p ? `${p.error ? 'error' : `${p.bugsFound}/${p.bugsKnown}`} | ${p.error ? '-' : p.falsePositives}` : '- | -')

const costCells = (p: PrScore | undefined) => (!p || p.error ? '- | -' : p.unpriced ? 'not measured | not measured' : `${p.inputTokens}/${p.outputTokens} | ${p.costUsd.toFixed(4)}`)

/** Requirement RF-02 (`mvp:RF-02`): real bugs and false positives per PR and in total, both reviewers, one counting rule. */
export function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const { incumbent, candidate, set, run } = report
  const lines = [
    `# Reviewer benchmark: ${report.decision}`,
    '',
    'Requirement `mvp:RF-02`: real bugs found and false positives of both reviewers, per PR and in total.',
    '',
    ...report.reasons.map((reason) => `- ${reason}`),
    '',
    ...(report.candidateVersion || report.datasetSha256 ? [`Candidate version: ${report.candidateVersion ?? 'unrecorded'}; dataset sha256: ${report.datasetSha256 ?? 'unrecorded'}`, ''] : []),
    '## Set and version (`mvp:RF-01`)',
    '',
    `Both reviewers were given exactly these PRs, each at the pinned head commit below (the runner stops on a PR whose head moved).`,
    '',
    `- Set: \`${set.path}\`, format version ${set.version}, sha256 \`${set.digest}\``,
    `- ${set.prs} merged PRs: ${set.buggy} \`buggy\` (each bug cites the fix that proves it) and ${set.clean} \`clean\`, from ${set.repositories.join(', ')}`,
    ...(run ? [`- code-review: \`${run.codeReviewVersion}\`${run.gitCommit ? ` at commit \`${run.gitCommit}\`` : ''}`] : []),
    '',
    '| PR | Label | Commit given to both reviewers |',
    '| --- | --- | --- |',
    ...set.commits.map((c) => `| ${c.id} | ${c.label} | \`${c.commit}\` |`),
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
    '| Reviewer | Bugs found | False positives | Input tokens | Output tokens | Cost (US$) | Mean latency (ms) | p90 latency (ms) | Errored PRs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...[incumbent, candidate].map((s) => `| ${s.name} | ${s.bugsFound}/${s.bugsKnown} | ${s.falsePositives} | ${s.inputTokens} | ${s.outputTokens} | ${s.costUsd.toFixed(2)} | ${s.meanLatencyMs} | ${s.p90LatencyMs} | ${s.erroredPrs} |`),
    '',
    '## Per PR',
    '',
    '| PR | incumbent bugs | incumbent false positives | code-review bugs | code-review false positives |',
    '| --- | --- | --- | --- | --- |',
    ...incumbent.perPr.map((p) => `| ${p.id} | ${cell(p)} | ${cell(candidate.perPr.find((c) => c.id === p.id))} |`),
    `| **Total** | **${incumbent.bugsFound}/${incumbent.bugsKnown}** | **${incumbent.falsePositives}** | **${candidate.bugsFound}/${candidate.bugsKnown}** | **${candidate.falsePositives}** |`,
    '',
    '## Falsos positivos por categoria',
    '',
    'Findings that matched no known bug, grouped by title (the rule that produced them). The finding list of every PR, with its verdict and the known bug it matched, is in `quality/benchmark/report.json` (`perPr[].findings`); a failed PR keeps its cause in `perPr[].errorDetail`.',
    '',
    ...[incumbent, candidate].flatMap((side) => {
      const categories = falsePositiveCategories(side)
      return [
        `### ${side.name}`,
        '',
        ...(categories.length
          ? ['| Category (title) | False positives | Examples |', '| --- | --- | --- |', ...categories.map((c) => `| ${mdCell(c.category)} | ${c.count} | ${c.examples.join(', ')} |`)]
          : ['No false positives.']),
        '',
      ]
    }),
    '## Failed PRs',
    '',
    ...(() => {
      const failed = [incumbent, candidate].flatMap((side) => side.perPr.filter((p) => p.error).map((p) => ({ side: side.name, p })))
      if (!failed.length) return ['No PR errored.', '']
      return ['| Reviewer | PR | Stage | Exit | Cause |', '| --- | --- | --- | --- | --- |', ...failed.map(({ side, p }) => `| ${side} | ${p.id} | ${p.errorDetail?.stage ?? '-'} | ${p.errorDetail?.exitCode ?? '-'} | ${mdCell(p.errorDetail?.stderrTail.at(-1) ?? p.error ?? '')} |`), '']
    })(),
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
    'The incumbent command is run as `<executable> <owner/repo> <number> <commit>` (the pinned commit of the set) and prints `{"findings":[{"file","line","title"}],"model","inputTokens","outputTokens"}`; see `docs/reviewer-benchmark.md`.',
  ]
  return `${lines.join('\n')}\n`
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface VersionPinCheck { ok: boolean; version?: string; reasons: string[] }

/**
 * Gate for the version the line installs: it must be an exact version (no `latest`, tag or range), the
 * benchmark report must be PASS for that same version and, when given, for the current labelled dataset.
 * Changing the pinned version or the dataset therefore requires a new measurement against the incumbent.
 */
export function checkVersionPin(report: Pick<BenchmarkReport, 'decision' | 'candidateVersion' | 'datasetSha256'>, pin: string, datasetSha256?: string): VersionPinCheck {
  const spec = pin.trim().replace(/^@agentskit\/code-review@/, '')
  const reasons: string[] = []
  if (!EXACT_VERSION.test(spec)) reasons.push(`pin "${pin}" is not an exact version (no latest, tags or ranges)`)
  if (report.decision !== 'PASS') reasons.push(`benchmark decision is ${report.decision}, not PASS`)
  if (!report.candidateVersion) reasons.push('benchmark report does not record the measured candidate version')
  else if (EXACT_VERSION.test(spec) && report.candidateVersion !== spec) reasons.push(`pinned ${spec} was not measured; the report measured ${report.candidateVersion}`)
  if (datasetSha256 !== undefined && report.datasetSha256 !== datasetSha256) reasons.push('benchmark report was not run on the current labelled dataset')
  return { ok: reasons.length === 0, ...(EXACT_VERSION.test(spec) ? { version: spec } : {}), reasons }
}
