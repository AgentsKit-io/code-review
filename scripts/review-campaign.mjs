#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createGithubScmAdapter } from '../dist/src/github-scm-adapter.js'
import { blockedCampaignPreflightReport, preflightCampaign } from '../dist/src/campaign-preflight.js'
import { configFingerprint, loadProjectConfig } from '../dist/src/public-config.js'
import { diagnoseProvider } from '../dist/src/provider-registry.js'

const value = (name) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1] }
const write = (file, report) => {
  if (!file) return
  const target = resolve(file); mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, target)
}

let report
try {
  const configFile = value('config')
  if (!configFile) throw new Error('missing --config <path>')
  const { config } = await loadProjectConfig(process.cwd(), configFile)
  const providerHealth = await diagnoseProvider({ provider: config.review.provider, model: config.review.model, mode: config.review.mode, live: false })
  const token = process.env.GITHUB_TOKEN || String(spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10_000 }).stdout ?? '').trim()
  const blockers = [
    ...(config.target.provider === 'github' ? [] : [{ id: 'scm.provider', ok: false, detail: `SCM provider ${config.target.provider} is not implemented` }]),
    ...(token ? [] : [{ id: 'scm.credentials', ok: false, detail: 'GitHub credential unavailable; set GITHUB_TOKEN or run gh auth login' }]),
  ]
  if (blockers.length) {
    report = blockedCampaignPreflightReport({ repository: config.target.repository, configFingerprint: configFingerprint(config), checks: [...blockers, ...providerHealth.checks.filter((check) => check.status === 'fail').map((check) => ({ id: `provider.${check.name}`, ok: false, detail: check.detail }))] })
  } else {
    report = await preflightCampaign({ config, adapter: createGithubScmAdapter({ token }), providerHealth })
  }
} catch (error) {
  report = blockedCampaignPreflightReport({ checks: [{ id: 'command', ok: false, detail: error instanceof Error ? error.message : String(error) }] })
}
try { write(value('output'), report) }
catch (error) {
  report = { ...report, status: 'blocked', checks: [...report.checks, { id: 'output.write', ok: false, detail: error instanceof Error ? error.message : String(error) }], pullRequests: report.pullRequests.map((pull) => ({ ...pull, worktreeAllowed: false })) }
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = report.status === 'ready' ? 0 : 2
