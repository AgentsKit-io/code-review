#!/usr/bin/env node
// Requirement RF-10 (`mvp:RF-10`): Code Review as the decision of the factory line's review stage.
//   line-review.mjs                      review the changed files of the checkout in the working directory
//   line-review.mjs <owner/repo> <n>     review that GitHub PR (needs GITHUB_TOKEN)
// The LAST line of stdout is {"decision","decidedBy","reason","comment","costUsd","findings","at",...}; decision is
// approve | request_changes | fallback (the incumbent reviews this PR) | block. Exit: 0 approve, 1 request_changes, 2 block, 3 fallback.
// Fail closed: without a PASS in the benchmark report shipped with this version (quality/benchmark/report.json) it
// falls back to the incumbent without calling a provider, and a failed or incomplete review never approves.
// Configuration comes from the environment only: AGENTSKIT_LINE_PROVIDER, AGENTSKIT_LINE_MODEL, AGENTSKIT_LINE_MODE,
// AGENTSKIT_LINE_CONFIG, AGENTSKIT_LINE_USD_PER_MTOK, AGENTSKIT_LINE_BASE (default origin/main),
// AGENTSKIT_LINE_ON_FAILURE (incumbent, the default, or block), AGENTSKIT_LINE_BENCHMARK_REPORT (another report path),
// AGENTSKIT_LINE_RECORD (a JSONL file; every decision is appended, so its first line records the first PR decided).
import { appendFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMarkdown } from '../dist/agents/code-review/reporters.js'
import { decideLineReview, LINE_DECISION_EXIT, parseLineFailurePolicy } from '../dist/src/line-reviewer.js'
import { isPrReference, packageRoot, runReview } from './reviewer-run.mjs'

const env = process.env
const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
const usage = (message) => { process.stderr.write(`line-review: ${message}\n`); process.exit(LINE_DECISION_EXIT.block) }

const [repository, number] = process.argv.slice(2)
if (repository && !isPrReference(repository, number)) usage('usage: line-review.mjs [<owner/repo> <number>]')
let onFailure
try { onFailure = parseLineFailurePolicy(env.AGENTSKIT_LINE_ON_FAILURE) } catch (error) { usage(error.message) }

const reportPath = resolve(env.AGENTSKIT_LINE_BENCHMARK_REPORT || join(packageRoot, 'quality/benchmark/report.json'))
let benchmarkDecision
try { benchmarkDecision = JSON.parse(readFileSync(reportPath, 'utf8')).decision } catch { benchmarkDecision = undefined }

let run = { costUsd: 0 }
if (benchmarkDecision === 'PASS') {
  run = await runReview({ repository, number, prefix: 'AGENTSKIT_LINE' })
  // Deleted files are not reviewed, so a change with nothing reviewable is not an approval either.
  if (run.files === 0) run = { costUsd: 0, failure: 'no added or modified files to review' }
}
const decided = decideLineReview({ benchmarkDecision, review: run.review, failure: run.failure, onFailure })
const record = {
  ...decided,
  at: new Date().toISOString(),
  ...(repository ? { repository, number: Number(number) } : {}),
  benchmarkDecision: benchmarkDecision ?? null,
  comment: run.review ? renderMarkdown(run.review) : `## Code review\n\n${decided.reason}.`,
  costUsd: run.costUsd ?? 0,
  findings: (run.review?.findings ?? []).map((f) => ({ file: f.file, line: f.line, title: f.title })),
}
if (env.AGENTSKIT_LINE_RECORD) appendFileSync(resolve(env.AGENTSKIT_LINE_RECORD), `${JSON.stringify({ at: record.at, repository: record.repository, number: record.number, decision: record.decision, decidedBy: record.decidedBy, reason: record.reason, benchmarkDecision: record.benchmarkDecision, costUsd: record.costUsd, findings: record.findings.length })}\n`)
emit(record)
process.exit(LINE_DECISION_EXIT[decided.decision])
