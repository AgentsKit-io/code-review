import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('..', import.meta.url).pathname
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.bin['agentskit-quality'], 'scripts/evaluate-quality.mjs')
const fixture = {
  runId: 'cli-fixture', version: '0.6.0', sourceRevision: 'fixture-sha',
  coverage: { eligibleFiles: 1, reviewedFiles: 1, unreviewedFiles: 0, requiredLensRuns: 1, completedRequiredLensRuns: 1 },
  findings: { expected: 1, detectedExpected: 1, falsePositives: 0, duplicates: 0, severityMatches: 1, severityTotal: 1, actionable: 1, detected: 1 },
  comments: { inlineExpected: 1, inlineValid: 1, actionable: 1, total: 1 },
  security: { secretLeaks: 0, unsafeActions: 0, failClosedViolations: 0 },
  reliability: { runs: 1, completeRuns: 1, incompleteAccepted: 0, staleArtifactsAccepted: 0, silentFailures: 0 },
  performance: { p95Ms: 100, baselineP95Ms: 100 },
  tokens: { tokensUsed: 100, changedLines: 10, validFindings: 1, baselineTokensPerChangedLine: 10 },
  batches: { planned: 1, completed: 1, retried: 0, overBudget: 0 },
  memory: { enabled: true, persistencePass: true, loadPass: true, malformedRejected: true, feedbackRecorded: true, rulesApproved: true, learningEvaluationPass: true, learningDetectionLift: true, learningPrecisionPass: true, learningTokenPass: true },
  configuration: { validAccepted: true, invalidRejected: true, schemaAvailable: true },
  integration: { githubPass: true, orcaPass: true, releasePass: true, mergeSafetyPass: true },
}

test('quality matrix CLI writes a passing report and uses exit code zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-quality-'))
  try {
    const input = join(directory, 'input.json')
    const output = join(directory, 'report.json')
    writeFileSync(input, JSON.stringify(fixture))
    const result = spawnSync(process.execPath, ['scripts/evaluate-quality.mjs', '--input', input, '--output', output], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).decision, 'PASS')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('quality matrix CLI exits two for a blocked report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-quality-'))
  try {
    const input = join(directory, 'input.json')
    writeFileSync(input, JSON.stringify({ ...fixture, security: { ...fixture.security, secretLeaks: 1 } }))
    const result = spawnSync(process.execPath, ['scripts/evaluate-quality.mjs', '--input', input], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.equal(JSON.parse(result.stdout).decision, 'BLOCKED')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('quality matrix CLI returns structured blocked evidence for malformed runner input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentskit-quality-'))
  try {
    const input = join(directory, 'input.json')
    const output = join(directory, 'report.json')
    writeFileSync(input, JSON.stringify({ findingsQuality: 'not the public QualityInput schema' }))
    const result = spawnSync(process.execPath, ['scripts/evaluate-quality.mjs', '--input', input, '--output', output], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 2)
    const report = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(report.decision, 'BLOCKED')
    assert.match(report.inputError, /coverage must be an object/)
    assert.equal(report.areas.length, 14)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('quality matrix CLI fails closed with structured evidence when input is missing', () => {
  const result = spawnSync(process.execPath, ['scripts/evaluate-quality.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 2)
  const report = JSON.parse(result.stdout)
  assert.equal(report.decision, 'BLOCKED')
  assert.match(report.inputError, /quality-input\.json/)
})
