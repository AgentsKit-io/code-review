import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { CampaignExecutionReportSchema, executeCampaign, writeAtomicJson } from '../dist/src/index.js'
import { stableFingerprint } from '../dist/src/stable-fingerprint.js'

const fp = 'a'.repeat(64)
const entry = (id, status = 'ready') => ({
  ref: { repository: 'AgentsKit-io/code-review', id: String(id) }, title: `PR ${id}`, author: 'member', headRevision: String(id).repeat(40).slice(0, 40),
  status, reasons: status === 'ready' ? [] : [`${status} by preflight`], worktreeAllowed: status === 'ready', plan: null,
})
const preflight = (entries, status = entries.some((item) => item.status === 'blocked') ? 'blocked' : 'ready') => ({
  version: 1, repository: 'AgentsKit-io/code-review', configFingerprint: fp, generatedAt: '2026-09-09T00:00:00.000Z', status,
  modelCalls: 0, worktreesCreated: 0, checks: [{ id: 'fixture', ok: true, detail: 'ready' }], pullRequests: entries,
})
const withRoot = async (run) => {
  const root = mkdtempSync(join(tmpdir(), 'campaign-runner-'))
  try { await run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('bounded workers isolate failures and report every discovered PR exactly once', async () => withRoot(async (stateRoot) => {
  let active = 0; let maximum = 0
  const report = await executeCampaign({
    preflight: preflight([entry(3), entry(1), entry(2), entry(4, 'skipped'), entry(5, 'blocked')]), stateRoot, concurrency: 2,
    execute: async ({ ref }) => {
      active += 1; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1
      if (ref.id === '2') throw new Error('isolated failure')
      return { outcome: 'APPROVED' }
    },
  })
  assert.equal(maximum, 2)
  assert.deepEqual(report.pullRequests.map(({ ref }) => ref.id), ['3', '1', '2', '4', '5'])
  assert.equal(new Set(report.pullRequests.map(({ ref }) => `${ref.repository}#${ref.id}`)).size, 5)
  assert.deepEqual(Object.fromEntries(report.pullRequests.map((item) => [item.ref.id, item.outcome])), { 1: 'APPROVED', 2: 'BLOCKED', 3: 'APPROVED', 4: 'SKIPPED', 5: 'BLOCKED' })
  assert.equal(report.outcome, 'PARTIAL')
  CampaignExecutionReportSchema.parse(report)
}))

test('a terminal checkpoint resumes without repeating completed work', async () => withRoot(async (stateRoot) => {
  let calls = 0
  const input = { preflight: preflight([entry(1)]), stateRoot, campaignId: 'resume-complete', execute: async () => { calls += 1; return { outcome: 'APPROVED' } } }
  const first = await executeCampaign(input)
  const second = await executeCampaign(input)
  assert.equal(first.outcome, 'COMPLETE')
  assert.deepEqual(second, first)
  assert.equal(calls, 1)
}))

test('an interrupted running item is safely requeued on resume', async () => withRoot(async (stateRoot) => {
  const input = { preflight: preflight([entry(1)]), stateRoot, campaignId: 'resume-running', execute: async () => ({ outcome: 'APPROVED' }) }
  const completed = await executeCampaign(input)
  const { checkpointFingerprint: _checkpoint, ...completedPayload } = completed
  const interruptedPayload = JSON.parse(JSON.stringify({ ...completedPayload, state: 'running', outcome: null, finishedAt: undefined, pullRequests: completed.pullRequests.map((item) => ({ ...item, state: 'running', outcome: null, finishedAt: undefined })) }))
  const interrupted = CampaignExecutionReportSchema.parse({ ...interruptedPayload, checkpointFingerprint: stableFingerprint(interruptedPayload) })
  writeAtomicJson(join(stateRoot, 'campaigns', stableFingerprint('resume-running'), 'execution.json'), interrupted)
  let calls = 0
  const resumed = await executeCampaign({ ...input, execute: async () => { calls += 1; return { outcome: 'CHANGES_REQUESTED' } } })
  assert.equal(calls, 1)
  assert.equal(resumed.pullRequests[0].attempts, 2)
  assert.equal(resumed.pullRequests[0].outcome, 'CHANGES_REQUESTED')
  assert.equal(resumed.outcome, 'COMPLETE')
}))

test('blocked and cancelled campaigns have deterministic terminal outcomes without execution', async () => withRoot(async (stateRoot) => {
  let calls = 0
  const blocked = await executeCampaign({ preflight: preflight([entry(1, 'blocked')]), stateRoot, campaignId: 'blocked', execute: async () => { calls += 1; return { outcome: 'APPROVED' } } })
  const controller = new AbortController(); controller.abort()
  const cancelled = await executeCampaign({ preflight: preflight([entry(2)]), stateRoot, campaignId: 'cancelled', signal: controller.signal, execute: async () => { calls += 1; return { outcome: 'APPROVED' } } })
  assert.equal(calls, 0)
  assert.equal(blocked.outcome, 'BLOCKED')
  assert.equal(cancelled.outcome, 'CANCELLED')
}))

test('continueAfterPerPrFailure=false stops later work without an orchestration decision', async () => withRoot(async (stateRoot) => {
  const called = []
  const report = await executeCampaign({
    preflight: preflight([entry(1), entry(2), entry(3)]), stateRoot, concurrency: 1, continueAfterPerPrFailure: false,
    execute: async ({ ref }) => { called.push(ref.id); if (ref.id === '1') throw new Error('stop'); return { outcome: 'APPROVED' } },
  })
  assert.deepEqual(called, ['1'])
  assert.deepEqual(report.pullRequests.map((item) => item.outcome), ['BLOCKED', 'CANCELLED', 'CANCELLED'])
  assert.equal(report.outcome, 'CANCELLED')
}))

test('a PR-scoped lease blocks only the overlapping PR and lets independent work continue', async () => withRoot(async (stateRoot) => {
  let release
  const hold = new Promise((resolve) => { release = resolve })
  const first = executeCampaign({ preflight: preflight([entry(1)]), stateRoot, campaignId: 'first', execute: async () => { await hold; return { outcome: 'APPROVED' } } })
  await new Promise((resolve) => setTimeout(resolve, 20))
  let duplicateCalls = 0
  const executed = []
  const second = await executeCampaign({ preflight: preflight([entry(1), entry(2)]), stateRoot, campaignId: 'second', concurrency: 1, execute: async ({ ref }) => { duplicateCalls += Number(ref.id === '1'); executed.push(ref.id); return { outcome: 'APPROVED' } } })
  release()
  assert.equal((await first).outcome, 'COMPLETE')
  assert.equal(second.outcome, 'PARTIAL')
  assert.equal(second.pullRequests[0].outcome, 'BLOCKED')
  assert.equal(second.pullRequests[1].outcome, 'APPROVED')
  assert.deepEqual(executed, ['2'])
  assert.equal(duplicateCalls, 0)
}))

test('checkpoint schemas reject contradictory, duplicate, and tampered reports', async () => withRoot(async (stateRoot) => {
  const report = await executeCampaign({ preflight: preflight([entry(1)]), stateRoot, execute: async () => ({ outcome: 'APPROVED' }) })
  assert.equal(CampaignExecutionReportSchema.safeParse({ ...report, outcome: null }).success, false)
  assert.equal(CampaignExecutionReportSchema.safeParse({ ...report, pullRequests: [...report.pullRequests, report.pullRequests[0]] }).success, false)
  assert.equal(CampaignExecutionReportSchema.safeParse({ ...report, pullRequests: report.pullRequests.map((item) => ({ ...item, outcome: 'CHANGES_REQUESTED' })) }).success, false)
}))

test('a corrupt checkpoint preserves every discovered PR as a blocked terminal report', async () => withRoot(async (stateRoot) => {
  const campaignId = 'corrupt'
  await executeCampaign({ preflight: preflight([entry(1), entry(2)]), stateRoot, campaignId, execute: async () => ({ outcome: 'APPROVED' }) })
  writeAtomicJson(join(stateRoot, 'campaigns', stableFingerprint(campaignId), 'execution.json'), { invalid: true })
  const report = await executeCampaign({ preflight: preflight([entry(1), entry(2)]), stateRoot, campaignId, execute: async () => ({ outcome: 'APPROVED' }) })
  assert.equal(report.pullRequests.length, 2)
  assert.deepEqual(report.pullRequests.map((item) => item.outcome), ['BLOCKED', 'BLOCKED'])
  assert.equal(report.outcome, 'BLOCKED')
}))

test('cancellation aborts an active PR worker before returning', async () => withRoot(async (stateRoot) => {
  const controller = new AbortController()
  let started
  const active = new Promise((resolve) => { started = resolve })
  const running = executeCampaign({
    preflight: preflight([entry(1)]), stateRoot, signal: controller.signal,
    execute: async (_entry, signal) => new Promise((_resolve, reject) => {
      started()
      signal.addEventListener('abort', () => reject(new Error('worker aborted')), { once: true })
    }),
  })
  await active
  controller.abort()
  const report = await running
  assert.equal(report.outcome, 'CANCELLED')
  assert.equal(report.pullRequests[0].outcome, 'CANCELLED')
}))
