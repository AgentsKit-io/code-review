import { writeFileSync } from 'node:fs'
import type { Finding, Reporter, ReviewResult } from './agent.js'
import { createGithubScmAdapter } from '../../src/github-scm-adapter.js'
import type { ChangeRequestRef, ScmAdapter } from '../../src/scm-contract.js'

/**
 * Reporters turn a ReviewResult into an output surface. They are orchestration code
 * (string building + GitHub REST), not model calls. Add your own by implementing
 * `Reporter` and passing it in `reporters`.
 *
 * The GitHub compatibility reporters route through the common SCM adapter. The model-facing equivalents are
 * the `github_create_pr_review_comment` / `github_create_pr_review` tools in
 * `@agentskit/tools` — use those when an LLM should decide to post; use these reporters
 * when orchestration posts deterministically after the pipeline.
 */

const SEV_ORDER: Finding['severity'][] = ['blocker', 'high', 'med', 'nit']
const SEV_EMOJI: Record<Finding['severity'], string> = { blocker: '⛔', high: '🔴', med: '🟡', nit: '🔵' }

export interface GithubCommentPolicy {
  renderer?: 'github-inline' | 'coderabbit-inspired' | 'compact' | 'detailed'
  language?: string
  inline?: boolean
  summary?: boolean
  includeReason?: boolean
  includeImpact?: boolean
  includeInstructions?: boolean
  includeEvidence?: boolean
  collapsibleDetails?: boolean
}

function section(label: string, value: string, enabled: boolean): string {
  return enabled ? `**${label}**\n${value}` : ''
}

function renderInlineFinding(f: Finding, policy: GithubCommentPolicy = {}): string {
  const labels = policy.language?.toLowerCase().startsWith('pt')
    ? { why: 'Por que precisa de correção', required: 'Alteração necessária', acceptance: 'Verificação de aceitação', evidence: 'Evidência da revisão' }
    : { why: 'Why this needs correction', required: 'Required change', acceptance: 'Acceptance check', evidence: 'Review evidence' }
  const parts = [
    `**${SEV_EMOJI[f.severity]} ${f.severity} · ${f.category}** — ${f.title}`,
    section(labels.why, f.rationale, policy.includeReason !== false),
    section(labels.required, f.suggestion, policy.includeInstructions !== false),
    section(labels.acceptance, 'Verify the changed behavior prevents this condition and preserves the intended flow.', policy.includeImpact !== false),
    section(labels.evidence, `Verified finding · confidence ${f.confidence.toFixed(2)}`, policy.includeEvidence !== false),
  ].filter(Boolean)
  if (f.suggestedPatch && policy.renderer !== 'compact') parts.push(`\n\`\`\`diff\n${f.suggestedPatch}\n\`\`\``)
  return parts.join('\n\n')
}

function groupBySeverity(findings: Finding[]): string {
  const lines: string[] = []
  for (const sev of SEV_ORDER) {
    const group = findings.filter((f) => f.severity === sev)
    if (!group.length) continue
    lines.push(`\n### ${SEV_EMOJI[sev]} ${sev} (${group.length})\n`)
    for (const f of group) {
      lines.push(`- **${f.file}:${f.line}** — ${f.title} _(${f.category}, conf ${f.confidence.toFixed(2)})_`)
      lines.push(`  - ${f.rationale}`)
      lines.push(`  - 💡 ${f.suggestion}`)
      if (f.suggestedPatch) {
        const tag = f.patchValidated === true ? ' (build-validated)' : f.patchValidated === false ? ' (does not apply)' : ''
        lines.push(`  - <details><summary>suggested patch${tag}</summary>\n\n\`\`\`diff\n${f.suggestedPatch}\n\`\`\`\n</details>`)
      }
    }
  }
  return lines.join('\n')
}

/** Human-readable Markdown — to a sink (default stdout) and optionally a file. */
export function markdownReporter(opts: { write?: (s: string) => void; file?: string } = {}): Reporter {
  const write = opts.write ?? ((s: string) => process.stdout.write(s))
  return {
    name: 'markdown',
    async emit(review: ReviewResult) {
      const md = renderMarkdown(review)
      if (opts.file) writeFileSync(opts.file, md)
      write(md + '\n')
    },
  }
}

export function renderMarkdown(review: ReviewResult): string {
  const evidence = `\n\n_Evidence: profile=${review.evidence.profile}; provider calls=${review.evidence.providerCalls} (failed=${review.evidence.failedProviderCalls}, skipped=${review.evidence.skippedProviderCalls}); elapsed=${review.evidence.elapsedMs}ms; circuit=${review.evidence.circuitState}${review.evidence.deadlineExceeded ? '; deadline exceeded' : ''}_`
  const head = `## Code review — ${review.verdict}\n\n${review.summary}${evidence}`
  const body = review.findings.length ? groupBySeverity(review.findings) : '\nNo findings above threshold. ✅'
  const dropped = review.dropped.length ? `\n\n_${review.dropped.length} finding(s) dropped (verify/threshold). ${review.droppedNote ?? ''}_` : ''
  return `${head}\n${body}${dropped}\n`
}

/**
 * Compact, persistent PR-thread status. The actionable detail belongs on the
 * inline review comments; repeating every finding here creates a second,
 * competing review that is hard to scan and can drift from the diff.
 */
export function renderGithubWalkthrough(review: ReviewResult): string {
  const severity = SEV_ORDER
    .map((level) => {
      const count = review.findings.filter((finding) => finding.severity === level).length
      return count ? `${SEV_EMOJI[level]} ${count} ${level}` : undefined
    })
    .filter((entry): entry is string => entry !== undefined)
    .join(' · ')
  const coverage = `${review.execution.succeeded}/${review.execution.attempted} lens executions`
  const outcome = review.findings.length
    ? 'Actionable findings are attached inline to the relevant changed lines.'
    : 'No findings met the configured review threshold.'
  const dropped = review.dropped.length
    ? ` ${review.dropped.length} candidate finding(s) were rejected during verification or thresholding.`
    : ''
  return [
    `## AgentsKit review · ${review.verdict}`,
    '',
    review.summary,
    '',
    `**Result:** ${severity || '✅ no findings'}  ·  ${coverage}`,
    '',
    outcome + dropped,
    '',
    '<details><summary>Review evidence</summary>',
    '',
    `- Profile: \`${review.evidence.profile}\``,
    `- Provider calls: ${review.evidence.providerCalls} (failed: ${review.evidence.failedProviderCalls}, skipped: ${review.evidence.skippedProviderCalls})`,
    `- Elapsed: ${review.evidence.elapsedMs}ms · Circuit: ${review.evidence.circuitState}${review.evidence.deadlineExceeded ? ' · deadline exceeded' : ''}`,
    '',
    '</details>',
  ].join('\n')
}

/** Machine output: SARIF 2.1.0 for GitHub code-scanning / dashboards. */
export function sarifReporter(opts: { file?: string; write?: (s: string) => void } = {}): Reporter {
  const sevToLevel: Record<Finding['severity'], string> = { blocker: 'error', high: 'error', med: 'warning', nit: 'note' }
  return {
    name: 'sarif',
    async emit(review: ReviewResult) {
      const rulesSeen = new Map<string, { id: string; name: string }>()
      const results = review.findings.map((f) => {
        const ruleId = `code-review/${f.category}`
        if (!rulesSeen.has(ruleId)) rulesSeen.set(ruleId, { id: ruleId, name: f.category })
        return {
          ruleId,
          level: sevToLevel[f.severity],
          message: { text: `${f.title} — ${f.rationale} Suggestion: ${f.suggestion}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: { startLine: f.line, ...(f.endLine ? { endLine: f.endLine } : {}) },
              },
            },
          ],
          properties: { severity: f.severity, confidence: f.confidence },
        }
      })
      const sarif = {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'agentskit-code-review', rules: [...rulesSeen.values()].map((r) => ({ id: r.id, name: r.name })) } },
            results,
          },
        ],
      }
      const text = JSON.stringify(sarif, null, 2)
      if (opts.file) writeFileSync(opts.file, text)
      if (opts.write) opts.write(text)
    },
  }
}

/** Private machine-readable handoff for an orchestrator; never posts to GitHub. */
export function jsonReporter(opts: { file: string }): Reporter {
  return { name: 'json', async emit(review: ReviewResult) { writeFileSync(opts.file, JSON.stringify(review, null, 2), { mode: 0o600 }) } }
}

function markerIdentity(marker?: string): { headRevision?: string; fingerprint?: string } {
  const match = marker?.match(/sha=([^ ]+) fingerprint=([^ ]+) -->/)
  return match ? { headRevision: match[1], fingerprint: match[2] } : {}
}

export function scmReviewReporter(c: { adapter: ScmAdapter; ref: ChangeRequestRef; channel: 'review' | 'summary'; headRevision: string; fingerprint?: string; policy?: GithubCommentPolicy }): Reporter {
  return {
    name: `scm-${c.channel}`,
    async emit(review: ReviewResult) {
      if (c.channel === 'summary') {
        if (c.policy?.summary === false) return
        await c.adapter.publishReview(c.ref, { channel: 'summary', headRevision: c.headRevision, ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}), verdict: review.verdict === 'REQUEST CHANGES' ? 'REQUEST_CHANGES' : review.verdict, summary: renderGithubWalkthrough(review), annotations: [] })
        return
      }
      const inline = c.policy?.inline === false ? [] : review.findings.filter((finding) => finding.inDiff)
      const outOfDiff = review.findings.filter((finding) => !finding.inDiff)
      const summary = `## Code review — ${review.verdict}\n\n${review.summary}` +
        (outOfDiff.length ? `\n\n### Findings outside the diff\n${groupBySeverity(outOfDiff)}` : '')
      if (c.policy?.summary === false && inline.length === 0) return
      await c.adapter.publishReview(c.ref, {
        channel: 'review', headRevision: c.headRevision, ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}),
        verdict: review.verdict === 'REQUEST CHANGES' ? 'REQUEST_CHANGES' : review.verdict,
        summary,
        annotations: inline.map((finding) => ({ path: finding.file, line: finding.line, ...(finding.endLine ? { endLine: finding.endLine } : {}), body: renderInlineFinding(finding, c.policy) })),
      })
    },
  }
}

/** One summary comment on the PR thread (uses the issues endpoint — always available). */
export function githubSummaryReporter(c: { owner: string; repo: string; number: number; token: string; marker?: string }): Reporter {
  const identity = markerIdentity(c.marker)
  return { ...scmReviewReporter({ adapter: createGithubScmAdapter({ token: c.token }), ref: { repository: `${c.owner}/${c.repo}`, id: String(c.number) }, channel: 'summary', headRevision: identity.headRevision ?? 'unknown', ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}) }), name: 'github-summary' }
}

/**
 * A batched PR review: inline comments on findings that land inside the diff, plus an
 * overall verdict + summary body. Findings outside the diff are folded into the body
 * (GitHub rejects review comments on unchanged lines).
 */
export function githubInlineReporter(c: { owner: string; repo: string; number: number; token: string; commitId?: string; marker?: string; policy?: GithubCommentPolicy }): Reporter {
  const identity = markerIdentity(c.marker)
  return { ...scmReviewReporter({ adapter: createGithubScmAdapter({ token: c.token }), ref: { repository: `${c.owner}/${c.repo}`, id: String(c.number) }, channel: 'review', headRevision: c.commitId ?? identity.headRevision ?? 'unknown', ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}), policy: c.policy }), name: 'github-inline' }
}
