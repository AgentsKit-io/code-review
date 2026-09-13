import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createCodeReviewAgent } from '../dist/agents/code-review/agent.js'
import { codexCli } from '../dist/src/codex-adapter.js'
import { evaluateQuality } from '../dist/src/quality-matrix.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixtureBin = join(root, 'test/fixtures/bin')
const corpus = JSON.parse(readFileSync(join(root, 'quality/evals/default.json'), 'utf8'))

const PROTECTED_SUBJECTS = ['memory-safety', 'concurrency', 'behavioral-change', 'unused-parameter', 'linkage-consistency']

test('semantic eval corpus is versioned, balanced, and structurally complete', () => {
  assert.equal(corpus.version, 1)
  assert.ok(corpus.cases.length >= 20, 'corpus should cover at least 8 positive, 8 clean, and 4 protected-subject cases')
  const positive = corpus.cases.filter((entry) => entry.kind === 'positive')
  const clean = corpus.cases.filter((entry) => entry.kind === 'clean')
  const protectedCases = corpus.cases.filter((entry) => entry.protectedSubject)
  assert.ok(positive.length >= 8, 'expected at least 8 positive cases')
  assert.ok(clean.length >= 8, 'expected at least 8 clean cases')
  assert.ok(protectedCases.length >= 4, 'expected at least 4 protected-subject cases')
  for (const entry of protectedCases) assert.ok(PROTECTED_SUBJECTS.includes(entry.protectedSubject), `${entry.id}: unknown protectedSubject "${entry.protectedSubject}"`)
  for (const entry of corpus.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/)
    assert.equal(typeof entry.source, 'string')
    if (entry.kind === 'positive') assert.ok(entry.expected)
  }
})

test('fixture semantic evals preserve expected detections and clean precision', async () => {
  const previous = { path: process.env.PATH, corpus: process.env.CODEX_FIXTURE_QUALITY_CORPUS }
  process.env.PATH = `${fixtureBin}:${previous.path ?? ''}`
  process.env.CODEX_FIXTURE_QUALITY_CORPUS = '1'
  let detectedExpected = 0
  let detected = 0
  let falsePositives = 0
  let severityMatches = 0
  let severityWithinOne = 0
  let actionable = 0
  try {
    for (const entry of corpus.cases) {
      const review = await createCodeReviewAgent({
        adapter: codexCli(),
        source: { kind: 'stdin', filename: entry.kind === 'positive' ? 'snippet.ts' : `${entry.id}.${entry.language}`, content: entry.source },
        auditVotes: 1,
        consolidate: false,
        reporters: [],
      }).run()
      detected += review.findings.length
      if (entry.kind === 'clean') {
        falsePositives += review.findings.length
        assert.equal(review.findings.length, 0, `${entry.id}: clean case produced a finding`)
        continue
      }
      const finding = review.findings[0]
      const expected = entry.expected
      const title = finding?.title.toLowerCase() ?? ''
      const lineMatches = finding && Math.abs(finding.line - expected.line) <= expected.lineTolerance
      const titleMatches = finding && expected.titleIncludes.some((word) => title.includes(word))
      if (finding && lineMatches && titleMatches) detectedExpected += 1
      if (finding?.severity === expected.severity) severityMatches += 1
      if (finding && ['blocker', 'high', 'med', 'nit'].indexOf(finding.severity) >= 0 && Math.abs(['blocker', 'high', 'med', 'nit'].indexOf(finding.severity) - ['blocker', 'high', 'med', 'nit'].indexOf(expected.severity)) <= 1) severityWithinOne += 1
      if (finding?.rationale && finding.suggestion) actionable += 1
      assert.ok(lineMatches && titleMatches, `${entry.id}: expected finding was not preserved`)
    }
  } finally {
    if (previous.path === undefined) delete process.env.PATH
    else process.env.PATH = previous.path
    if (previous.corpus === undefined) delete process.env.CODEX_FIXTURE_QUALITY_CORPUS
    else process.env.CODEX_FIXTURE_QUALITY_CORPUS = previous.corpus
  }
  const positiveCount = corpus.cases.filter((entry) => entry.kind !== 'clean').length
  const report = evaluateQuality({
    runId: 'fixture-semantic-evals', version: '0.21.0', sourceRevision: 'fixture',
    evidence: { kind: 'synthetic', fixtureId: 'default-quality-evals' },
    coverage: { eligibleFiles: corpus.cases.length, reviewedFiles: corpus.cases.length, unreviewedFiles: 0, requiredLensRuns: corpus.cases.length * 3, completedRequiredLensRuns: corpus.cases.length * 3 },
    findings: { expected: positiveCount, detectedExpected, falsePositives, duplicates: 0, severityMatches, severityWithinOne, severityTotal: positiveCount, actionable, detected },
    comments: { inlineExpected: positiveCount, inlineValid: positiveCount, actionable, total: positiveCount },
    security: { secretLeaks: 0, unsafeActions: 0, failClosedViolations: 0 },
    reliability: { runs: corpus.cases.length, completeRuns: corpus.cases.length, incompleteAccepted: 0, staleArtifactsAccepted: 0, silentFailures: 0 },
    performance: { p95Ms: 1, baselineP95Ms: 1 },
    tokens: { tokensUsed: 1, changedLines: 1, validFindings: detected, baselineTokensPerChangedLine: 1 },
    batches: { planned: corpus.cases.length, completed: corpus.cases.length, retried: 0, overBudget: 0 },
    memory: { enabled: false, persistencePass: true, loadPass: true, malformedRejected: true, feedbackRecorded: true, rulesApproved: true, learningEvaluationPass: true, learningDetectionLift: true, learningPrecisionPass: true, learningTokenPass: true },
    configuration: { validAccepted: true, invalidRejected: true, schemaAvailable: true },
    integration: { githubPass: true, orcaPass: true, releasePass: true, mergeSafetyPass: true },
  })
  assert.equal(report.decision, 'PASS')
  assert.equal(report.areas.find((area) => area.area === 'detection')?.score, 4)
  assert.equal(report.areas.find((area) => area.area === 'precision')?.score, 4)
  assert.equal(report.areas.find((area) => area.area === 'severity')?.score, 4)
})

test('quality matrix blocks a run with missing required lens evidence', () => {
  const input = {
    evidence: { kind: 'synthetic', fixtureId: 'missing-lens' },
    coverage: { eligibleFiles: 1, reviewedFiles: 1, unreviewedFiles: 0, requiredLensRuns: 3, completedRequiredLensRuns: 2 },
    findings: { expected: 1, detectedExpected: 1, falsePositives: 0, duplicates: 0, severityMatches: 1, severityTotal: 1, actionable: 1, detected: 1 },
    comments: { inlineExpected: 1, inlineValid: 1, actionable: 1, total: 1 },
    security: { secretLeaks: 0, unsafeActions: 0, failClosedViolations: 0 },
    reliability: { runs: 1, completeRuns: 1, incompleteAccepted: 0, staleArtifactsAccepted: 0, silentFailures: 0 },
    performance: { p95Ms: 1, baselineP95Ms: 1 }, tokens: { tokensUsed: 1, changedLines: 1, validFindings: 1, baselineTokensPerChangedLine: 1 },
    batches: { planned: 1, completed: 1, retried: 0, overBudget: 0 },
    memory: { enabled: false, persistencePass: true, loadPass: true, malformedRejected: true, feedbackRecorded: true, rulesApproved: true, learningEvaluationPass: true, learningDetectionLift: true, learningPrecisionPass: true, learningTokenPass: true },
    configuration: { validAccepted: true, invalidRejected: true, schemaAvailable: true }, integration: { githubPass: true, orcaPass: true, releasePass: true, mergeSafetyPass: true },
  }
  const report = evaluateQuality(input)
  assert.equal(report.decision, 'BLOCKED')
  assert.equal(report.absoluteGates.find((gate) => gate.name === 'complete-file-coverage')?.passed, false)
})
