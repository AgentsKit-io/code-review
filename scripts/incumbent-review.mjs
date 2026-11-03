#!/usr/bin/env node
// Requirement RF-03 (`mvp:RF-03`): the incumbent reviewer (the factory line's single-pass `review` stage) as an
// executable the benchmark can run:  incumbent-review.mjs <owner/repo> <number> [<commit>]
// With <commit> (40-hex, the benchmark's pinned head) it fails non-zero when the PR head is another commit.
// It prints ONE JSON line on stdout: {"findings":[{"file","line","title"}],"costUsd":0}. Any failure exits non-zero
// with the reason on stderr (the benchmark records that PR as an error), so a PR is never silently scored as clean.
// Single pass, no lenses: the PR diff (GITHUB_TOKEN; GITHUB_API_URL overrides https://api.github.com) goes to a
// headless model CLI that reads the prompt on stdin. Configuration comes from the environment only:
// AGENTSKIT_INCUMBENT_CMD (default claude), AGENTSKIT_INCUMBENT_ARGS (JSON array, default ["-p","--output-format","json"]),
// AGENTSKIT_INCUMBENT_USD_PER_MTOK (cost = tokens x price; the CLI's usage is read from its JSON output),
// AGENTSKIT_INCUMBENT_MAX_DIFF_CHARS (default 400000; a larger diff is an error, never a truncated review).
import { runCommand, splitLines } from '@agentskit/cross-platform'

const env = process.env
const fail = (message) => { process.stderr.write(`incumbent-review: ${message}\n`); process.exit(1) }

const [repository, number, commit] = process.argv.slice(2)
if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^\d+$/.test(number ?? '') || (commit !== undefined && !/^[0-9a-f]{40}$/i.test(commit))) {
  process.stderr.write('usage: incumbent-review.mjs <owner/repo> <number> [<commit: 40-hex>]\n')
  process.exit(64)
}

export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidates = [text, fenced?.[1] ?? '', text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const candidate of candidates) {
    try { return JSON.parse(candidate.trim()) } catch { /* try the next shape */ }
  }
  return undefined
}

const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '')
const token = env.GITHUB_TOKEN || env.GH_TOKEN

async function checkHead() {
  const response = await fetch(`${base}/repos/${repository}/pulls/${number}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'agentskit-incumbent-review', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) fail(`could not read the head of ${repository}#${number}: HTTP ${response.status}`)
  const head = (await response.json())?.head?.sha
  if (typeof head !== 'string' || head.toLowerCase() !== commit.toLowerCase()) fail(`the head of ${repository}#${number} is ${head ?? 'unknown'}, not the pinned commit ${commit}`)
}

async function fetchDiff() {
  const response = await fetch(`${base}/repos/${repository}/pulls/${number}`, {
    headers: { accept: 'application/vnd.github.v3.diff', 'user-agent': 'agentskit-incumbent-review', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) fail(`could not fetch the diff of ${repository}#${number}: HTTP ${response.status}`)
  return response.text()
}

function runModel(prompt) {
  let args
  try { args = JSON.parse(env.AGENTSKIT_INCUMBENT_ARGS ?? '["-p","--output-format","json"]') } catch { fail('AGENTSKIT_INCUMBENT_ARGS must be a JSON array of strings') }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) fail('AGENTSKIT_INCUMBENT_ARGS must be a JSON array of strings')
  return runCommand(env.AGENTSKIT_INCUMBENT_CMD || 'claude', args, { input: prompt, timeoutMs: 1_800_000 })
}

if (commit) await checkHead()
const diff = await fetchDiff()
if (commit) await checkHead() // the head did not move while the diff was fetched
if (!diff.trim()) fail(`${repository}#${number} has an empty diff`)
if (diff.length > Number(env.AGENTSKIT_INCUMBENT_MAX_DIFF_CHARS ?? 400_000)) fail(`the diff of ${repository}#${number} is larger than AGENTSKIT_INCUMBENT_MAX_DIFF_CHARS`)

const prompt = [
  'You are the code reviewer of a pull request. Review the diff below in a single pass and report only real defects',
  '(bugs, security problems, broken edge cases, wrong behaviour); no style remarks. Cite the line in the NEW version of the file.',
  'Answer with ONLY this JSON and nothing else: {"findings":[{"file":"<path>","line":<number>,"title":"<one-line defect>"}]}',
  'Use {"findings":[]} when the change has no defect.',
  '', `Pull request: ${repository}#${number}`, '', '```diff', diff, '```', '',
].join('\n')

const run = await runModel(prompt)
if (run.code !== 0) fail(`reviewer exited ${run.code ?? run.signal}: ${splitLines(run.stderr.trim()).at(-1) ?? ''}`.slice(0, 300))

// A headless CLI prints an envelope { result, usage }; a plain command prints the answer itself.
let envelope
try { envelope = JSON.parse(run.stdout) } catch { envelope = undefined }
const answer = envelope && typeof envelope.result === 'string' ? extractJson(envelope.result) : extractJson(run.stdout)
if (!answer || !Array.isArray(answer.findings)) fail('the reviewer did not return {"findings":[...]}')
const findings = answer.findings.map((f) => ({ file: f?.file, line: Number(f?.line), title: f?.title }))
if (findings.some((f) => typeof f.file !== 'string' || !Number.isFinite(f.line) || typeof f.title !== 'string')) fail('a finding lacks file, numeric line or title')

const usage = envelope?.usage ?? {}
const tokens = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((total, key) => total + (Number(usage[key]) || 0), 0)
const costUsd = (tokens / 1e6) * Number(env.AGENTSKIT_INCUMBENT_USD_PER_MTOK ?? 0)
process.stdout.write(`${JSON.stringify({ findings, costUsd })}\n`)
