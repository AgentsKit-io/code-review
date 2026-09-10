#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { campaignReportDeliveryFailed, executeCampaign } from '../dist/src/campaign-runner.js'
import { redactDiagnostic } from '../dist/src/local-cli-process.js'
import { createGithubScmAdapter } from '../dist/src/github-scm-adapter.js'
import { blockedCampaignPreflightReport, preflightCampaign } from '../dist/src/campaign-preflight.js'
import { configFingerprint, loadProjectConfig } from '../dist/src/public-config.js'
import { diagnoseProvider } from '../dist/src/provider-registry.js'
import { packageVersion } from '../dist/src/review-policy.js'
import { evaluateCampaignQuality } from '../dist/src/quality-matrix.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const environmentSecrets = Object.entries(process.env).filter(([key, value]) => /(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key) && String(value).length >= 6).map(([, value]) => String(value))
const value = (name) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1] }
const post = process.argv.includes('--post')
const merge = process.argv.includes('--merge')
const automationId = value('automation-id') ?? process.env.ORCA_AUTOMATION_ID ?? 'agentskit-review-campaign'
const write = (file, report) => {
  if (!file) return
  const target = resolve(file); mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, target)
}
const run = (command, args, options) => new Promise((done) => {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let stdout = ''; let stderr = ''; let timedOut = false
  let settled = false
  let killTimer
  const kill = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, 5_000)
  }
  const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', kill); done(result) }
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, options.timeout)
  options.signal?.addEventListener('abort', kill, { once: true })
  if (options.signal?.aborted) kill()
  child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-200_000) })
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-20_000) })
  child.once('error', (error) => finish({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut }))
  child.once('close', (code) => finish({ code, stdout, stderr, timedOut }))
})

let report
let outputFailed = false
let campaignStateRoot
let campaignConfig
const campaignAbort = new AbortController()
const cancel = () => campaignAbort.abort(new Error('campaign interrupted'))
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
try {
  const configFile = value('config')
  if (!configFile) throw new Error('missing --config <path>')
  const loaded = await loadProjectConfig(process.cwd(), configFile)
  const config = loaded.config
  campaignConfig = config
  const providerHealth = await diagnoseProvider({ provider: config.review.provider, model: config.review.model, mode: config.review.mode, live: false })
  const token = process.env.GITHUB_TOKEN || String(spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10_000 }).stdout ?? '').trim()
  const blockers = [
    ...(config.target.provider === 'github' ? [] : [{ id: 'scm.provider', ok: false, detail: `SCM provider ${config.target.provider} is not implemented` }]),
    ...(token ? [] : [{ id: 'scm.credentials', ok: false, detail: 'GitHub credential unavailable; set GITHUB_TOKEN or run gh auth login' }]),
  ]
  const preflight = blockers.length
    ? blockedCampaignPreflightReport({ repository: config.target.repository, configFingerprint: configFingerprint(config), checks: [...blockers, ...providerHealth.checks.filter((check) => check.status === 'fail').map((check) => ({ id: `provider.${check.name}`, ok: false, detail: check.detail }))] })
    : await preflightCampaign({ config, adapter: createGithubScmAdapter({ token }), providerHealth, signal: campaignAbort.signal })
  const stateRoot = resolve(dirname(loaded.path ?? resolve(configFile)), config.execution.statePath)
  campaignStateRoot = stateRoot
  const workerTimeoutMs = Math.min(7_260_000, Math.max(config.review.deadlineMs + 60_000, config.review.deadlineMs * 2 + 60_000))
  report = await executeCampaign({
    preflight, stateRoot, concurrency: config.execution.maxConcurrentPullRequests,
    continueAfterPerPrFailure: config.execution.continueAfterPerPrFailure, resume: config.execution.resumeIncompleteRuns,
    signal: campaignAbort.signal, pullRequestLeaseTtlMs: workerTimeoutMs + 60_000,
    execute: async (entry, signal) => {
      const runId = hash(JSON.stringify({ packageVersion: packageVersion(), repository: entry.ref.repository, pull: entry.ref.id, headRevision: entry.headRevision, configFingerprint: configFingerprint(config) }))
      const runRoot = resolve(stateRoot, 'runs', `${entry.ref.repository.replace('/', '-')}-${entry.ref.id}-${runId.slice(0, 16)}`)
      const orcaEvidence = resolve(runRoot, 'orca-evidence.json')
      write(orcaEvidence, { version: 1, status: 'passed', runId, sourceRevision: entry.headRevision, libraryVersion: packageVersion(), automationId })
      try {
        const existing = JSON.parse(readFileSync(resolve(runRoot, 'cycle-summary.json'), 'utf8'))
        if (existing.runId === runId && existing.decision === 'COMPLETE') return { outcome: existing.fullReview?.verdict === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED', reason: `reused review verdict: ${existing.fullReview?.verdict ?? 'unknown'}` }
      } catch { /* no reusable terminal worker result */ }
      const args = [resolve(packageRoot, 'scripts/review-cycle.mjs'), '--repository', entry.ref.repository, '--pull', entry.ref.id, '--config', loaded.path ?? resolve(configFile), '--run-dir', runRoot, '--state-dir', resolve(stateRoot, 'pull-requests'), '--run-id', runId, '--provider', config.review.provider, '--mode', config.review.mode, '--max-calls', String(config.review.maxCalls), '--deadline-ms', String(config.review.deadlineMs), '--global-deadline-ms', String(Math.min(7_200_000, Math.max(config.review.deadlineMs, config.review.deadlineMs * 2))), '--batch-size', String(config.batches.size), '--batch-concurrency', '1', '--orca-evidence', orcaEvidence, ...(config.review.model ? ['--model', config.review.model] : []), ...(post ? ['--post'] : []), ...(merge ? ['--merge'] : [])]
      const result = await run(process.execPath, args, { cwd: stateRoot, env: { ...process.env, GITHUB_TOKEN: token }, signal, timeout: workerTimeoutMs })
      let summary
      try { summary = JSON.parse(readFileSync(resolve(runRoot, 'cycle-summary.json'), 'utf8')) } catch { throw new Error(result.timedOut ? 'single-PR review timed out' : redactDiagnostic(result.stderr || 'single-PR review summary is unavailable', [token, ...environmentSecrets])) }
      if (result.code !== 0 || summary.decision !== 'COMPLETE') throw new Error(redactDiagnostic(summary.problems?.join('; ') || result.stderr || `single-PR review exited ${result.code}`, [token, ...environmentSecrets]))
      return { outcome: summary.fullReview?.verdict === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED', reason: `review verdict: ${summary.fullReview?.verdict ?? 'unknown'}` }
    },
  })
} catch (error) {
  report = blockedCampaignPreflightReport({ checks: [{ id: 'command', ok: false, detail: error instanceof Error ? error.message : String(error) }] })
} finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
if ('outcome' in report) {
  const entries = report.pullRequests
  const qualityReports = []
  for (const entry of entries) {
    const runId = hash(JSON.stringify({ packageVersion: packageVersion(), repository: entry.ref.repository, pull: entry.ref.id, headRevision: entry.headRevision, configFingerprint: configFingerprint(campaignConfig) }))
    const file = resolve(campaignStateRoot, 'runs', `${entry.ref.repository.replace('/', '-')}-${entry.ref.id}-${runId.slice(0, 16)}`, 'quality-report.json')
    try { qualityReports.push(JSON.parse(readFileSync(file, 'utf8'))) } catch { /* missing reports are represented by the campaign coverage gate */ }
  }
  const counts = (outcome) => entries.filter((entry) => entry.outcome === outcome).length
  const started = Date.parse(report.startedAt)
  const finished = Date.parse(report.finishedAt ?? report.updatedAt)
  const campaign = {
    discovered: entries.length,
    terminal: entries.filter((entry) => entry.outcome !== null).length,
    completed: counts('APPROVED') + counts('CHANGES_REQUESTED'),
    partial: report.outcome === 'PARTIAL' ? 1 : 0,
    blocked: counts('BLOCKED'),
    skipped: counts('SKIPPED'),
    cancelled: counts('CANCELLED'),
    qualityReports: qualityReports.length,
    retries: entries.reduce((total, entry) => total + Math.max(0, entry.attempts - 1), 0),
    wastedCalls: qualityReports.reduce((total, matrix) => total + Number(matrix.rawInput?.batches?.wastedCalls ?? 0), 0),
    wallClockMs: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : 0,
  }
  const qualityMatrix = evaluateCampaignQuality({ evidence: { kind: 'real-campaign', campaignId: report.campaignId }, campaign, pullRequestReports: qualityReports })
  write(value('quality-output') ?? join(campaignStateRoot, 'campaigns', report.campaignId, 'quality-matrix.json'), qualityMatrix)
}
try { write(value('output'), report) }
catch (error) {
  outputFailed = true
  if ('checks' in report) report = { ...report, status: 'blocked', checks: [...report.checks, { id: 'output.write', ok: false, detail: error instanceof Error ? error.message : String(error) }], pullRequests: report.pullRequests.map((pull) => ({ ...pull, worktreeAllowed: false })) }
  else report = campaignReportDeliveryFailed(report, error instanceof Error ? error.message : String(error))
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = !outputFailed && (('outcome' in report && report.outcome === 'COMPLETE') || ('status' in report && report.status === 'ready')) ? 0 : 2
