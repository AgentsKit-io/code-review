import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  parseQualityBaseline,
  qualityBaselineIdentity,
  validateStudyOutputPath,
} from '../dist/src/quality-baseline.js'

const tokens = {
  input: null,
  cachedInput: null,
  output: null,
  reasoning: null,
  memory: null,
  retry: null,
  total: null,
}

const duration = {
  wallClockMs: 100,
  preflightMs: null,
  providerMs: null,
  verificationMs: null,
  publishingMs: null,
  mergeMs: null,
}

const identity = {
  libraryVersion: '0.8.0',
  sourceRevision: 'v0.8.0',
  policyFingerprint: 'a'.repeat(64),
  promptFingerprint: 'b'.repeat(64),
  model: 'fixture/codex-cli',
}

test('baseline v2 keeps synthetic, real run, and real campaign evidence distinct', () => {
  const baseline = parseQualityBaseline({
    schemaVersion: 2,
    baselineId: qualityBaselineIdentity(identity),
    identity,
    syntheticRuns: [{
      kind: 'synthetic-run', runId: 'fixture-clean', fixtureId: 'cycle/clean',
      outcome: 'APPROVED', tokens, duration,
      evidence: { origin: 'synthetic', fixtureId: 'cycle/clean', fingerprint: 'c'.repeat(64) },
    }],
    realRuns: [{
      kind: 'real-run', runId: 'canary-1', repository: 'AgentsKit-io/agentskit-os', pullNumber: 6099,
      headSha: 'd'.repeat(40), outcome: 'APPROVED', tokens, duration,
      evidence: { origin: 'real', repository: 'AgentsKit-io/agentskit-os', pullNumber: 6099, headSha: 'd'.repeat(40), fingerprint: 'e'.repeat(64) },
    }],
    realCampaigns: [{
      kind: 'real-campaign', campaignId: 'campaign-1', discovered: 7, terminal: 7, completed: 1, blocked: 6,
      tokens, duration,
      evidence: { origin: 'real', repository: 'AgentsKit-io/agentskit-os', fingerprint: 'f'.repeat(64) },
    }],
  })

  assert.equal(baseline.schemaVersion, 2)
  assert.equal(baseline.syntheticRuns[0].evidence.origin, 'synthetic')
  assert.equal(baseline.realRuns[0].evidence.origin, 'real')
  assert.equal(baseline.realCampaigns[0].terminal, 7)
  assert.equal(baseline.syntheticRuns[0].tokens.total, null)
})

test('real runs cannot pass synthetic evidence as real observations', () => {
  assert.throws(() => parseQualityBaseline({
    schemaVersion: 2,
    baselineId: qualityBaselineIdentity(identity),
    identity,
    syntheticRuns: [],
    realRuns: [{
      kind: 'real-run', runId: 'invalid', repository: 'AgentsKit-io/agentskit-os', pullNumber: 1,
      headSha: 'd'.repeat(40), outcome: 'APPROVED', tokens, duration,
      evidence: { origin: 'synthetic', fixtureId: 'fake-real', fingerprint: 'e'.repeat(64) },
    }],
    realCampaigns: [],
  }), /invalid quality baseline/)
})

test('baseline identity is stable across object insertion order', () => {
  const reordered = {
    model: identity.model,
    promptFingerprint: identity.promptFingerprint,
    policyFingerprint: identity.policyFingerprint,
    sourceRevision: identity.sourceRevision,
    libraryVersion: identity.libraryVersion,
  }
  assert.equal(qualityBaselineIdentity(identity), qualityBaselineIdentity(reordered))
})

test('study outputs may use an external directory but not the repository', () => {
  const external = mkdtempSync(join(tmpdir(), 'agentskit-quality-study-'))
  try {
    assert.equal(validateStudyOutputPath(join(external, 'baseline.json'), process.cwd()), join(external, 'baseline.json'))
    assert.throws(() => validateStudyOutputPath(join(process.cwd(), 'quality', 'studies', 'baseline.json'), process.cwd()), /outside the repository/)
  } finally {
    rmSync(external, { recursive: true, force: true })
  }
})
