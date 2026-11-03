// ReviewBench adapter: runs agentskit-review on one PR and writes the findings file.
// Configuration (RB_CONFIG_*): MODEL, VOTES, PROFILE, DEADLINE_MS. Credentials come from the environment, never printed.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const env = process.env
for (const n of ['RB_NWO', 'RB_PR_NUMBER', 'RB_BASE', 'RB_HEAD', 'RB_OUT']) {
  if (!env[n]) { console.error(`agent: missing ${n}`); process.exit(2) }
}
const repo = env.RB_REPO ?? '/work/repo'
const agent = env.RB_AGENT ?? 'agentskit-code-review'
const model = env.RB_CONFIG_MODEL ?? 'claude-sonnet-5-5'
const votes = env.RB_CONFIG_VOTES ?? '3'
const profile = env.RB_CONFIG_PROFILE ?? 'full'
const deadline = env.RB_CONFIG_DEADLINE_MS ?? '1500000'
console.error(`agent: model=${model} votes=${votes} profile=${profile} deadline_ms=${deadline}`)

const resultFile = '/tmp/review-result.json'
const started = Date.now()
const run = spawnSync('node', ['/app/dist/src/cli.js', '--provider', 'claude-cli', '--model', model,
  '--base', env.RB_BASE, '--votes', votes, '--profile', profile, '--deadline-ms', deadline,
  '--no-fail', '--result', resultFile], { cwd: repo, env, stdio: ['ignore', 'inherit', 'inherit'] })
console.error(`agent: exit=${run.status} duration_ms=${Date.now() - started}`)
if (run.status !== 0) process.exit(1)

const review = JSON.parse(readFileSync(resultFile, 'utf8'))
const findings = (review.findings ?? []).map((f) => ({
  file: f.file,
  start_line: f.line,
  end_line: Math.max(f.line, f.endLine ?? f.line),
  message: `${f.title}: ${f.rationale}${f.suggestion ? ` Suggestion: ${f.suggestion}` : ''}`,
  producer: agent,
}))
writeFileSync(env.RB_OUT, JSON.stringify({
  pr: { repo: `https://github.com/${env.RB_NWO}`, pr_number: Number(env.RB_PR_NUMBER), base: env.RB_BASE, head: env.RB_HEAD },
  agent,
  findings,
}, null, 2))
// Run metadata for RESULTS.md (not part of the contract).
writeFileSync(`${env.RB_OUT}.meta.json`, JSON.stringify({ model, votes, profile, durationMs: Date.now() - started, evidence: review.evidence, incomplete: review.incomplete, verdict: review.verdict, findings: findings.length }, null, 2))
console.error(`agent: ${findings.length} finding(s)`)
