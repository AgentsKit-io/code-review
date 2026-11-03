import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateShadowWeek, parseShadowWeekData, renderShadowWeekMarkdown } from '../dist/src/shadow-week.js'

const example = () => JSON.parse(readFileSync(new URL('../quality/shadow-week/example.json', import.meta.url), 'utf8'))

test('the synthetic week passes the three criteria', () => {
  const report = evaluateShadowWeek(parseShadowWeekData(example()))
  assert.equal(report.decision, 'PASS')
  assert.equal(report.days, 7)
  assert.equal(report.candidate.fixes, report.incumbent.fixes)
  assert.ok(report.candidate.falseAlarms < report.incumbent.falseAlarms)
  assert.match(renderShadowWeekMarkdown(report), /Shadow week: PASS/)
})

test('fails on fewer fixes, equal false alarms or cost over 1.2x', () => {
  const fewerFixes = example()
  fewerFixes.prs[0].reviewers['code-review'].findings = []
  assert.match(evaluateShadowWeek(parseShadowWeekData(fewerFixes)).reasons.join(), /fixes/)
  const noisy = example()
  for (const pr of noisy.prs) pr.reviewers['code-review'].findings = pr.reviewers.incumbent.findings
  assert.match(evaluateShadowWeek(parseShadowWeekData(noisy)).reasons.join(), /false alarms/)
  const costly = example()
  for (const pr of costly.prs) pr.reviewers['code-review'].tokens = 12100
  const report = evaluateShadowWeek(parseShadowWeekData(costly))
  assert.equal(report.decision, 'FAIL')
  assert.match(report.reasons.join(), /cost/)
})

test('is blocked below 7 days or outside 2-3 repositories', () => {
  const short = example()
  short.prs = short.prs.slice(0, 4)
  assert.equal(evaluateShadowWeek(parseShadowWeekData(short)).decision, 'BLOCKED')
  const single = example()
  for (const pr of single.prs) pr.repository = 'example-org/alpha'
  assert.match(evaluateShadowWeek(parseShadowWeekData(single)).reasons.join(), /repositories/)
})

test('rejects unclassified findings and missing price', () => {
  const bad = example()
  bad.prs[0].reviewers.incumbent.findings = [{ title: 'x' }]
  assert.throws(() => parseShadowWeekData(bad), /classified/)
  const noPrice = example()
  delete noPrice.usdPerMtok
  assert.throws(() => parseShadowWeekData(noPrice), /usdPerMtok/)
})
