#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareQuality, evaluateQuality, evaluateQualityAgainstBaseline } from '../dist/src/quality-matrix.js'
import { validateCanary } from '../dist/src/harness.js'
import { createReviewFeedbackStore, createReviewKnowledgeStore } from '../dist/src/review-stores.js'
import { createReviewReconciliationStore, reconcileReviewFeedback } from '../dist/src/review-feedback.js'
import { loadProjectConfig } from '../dist/src/public-config.js'
import { createGithubScmAdapter } from '../dist/src/github-scm-adapter.js'
import { createReviewCache } from '../dist/src/review-cache.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist/src/cli.js')
const harness = join(root, 'scripts/review-harness.mjs')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const shutdown = new AbortController()
const requestShutdown = () => shutdown.abort(new Error('review cycle interrupted'))
process.once('SIGINT', requestShutdown)
process.once('SIGTERM', requestShutdown)
const arg = (name) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1] }
const has = (name) => process.argv.includes(`--${name}`)
const required = (name) => { const value = arg(name); if (!value) throw new Error(`missing --${name}`); return value }
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const atomicJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
}
const safeExec = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? 90_000, env: options.env ?? process.env, cwd: options.cwd })
  return { ok: result.status === 0 && !result.error, stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? result.error?.message ?? '').trim(), status: result.status }
}
const check = (id, ok, message, remediation, evidence) => ({ id, severity: ok ? 'low' : 'blocker', ok, message, remediation, evidence })
const processResult = (command, args, options = {}) => new Promise((resolveRun) => {
  const child = spawn(command, args, { cwd: options.cwd ?? root, env: options.env ?? process.env, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let stdout = ''; let stderr = ''; let timedOut = false
  let settled = false; let killTimer
  const kill = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, 5_000)
  }
  const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); shutdown.signal.removeEventListener('abort', kill); resolveRun(result) }
  const timer = setTimeout(() => {
    timedOut = true
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }, options.timeout ?? 660_000)
  shutdown.signal.addEventListener('abort', kill, { once: true })
  if (shutdown.signal.aborted) kill()
  child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-200_000) })
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-200_000) })
  child.once('close', (code, signal) => finish({ code, signal, timedOut, stdout, stderr }))
  child.once('error', (error) => finish({ code: null, timedOut, stdout, stderr: `${stderr}\n${error.message}` }))
  if (options.input !== undefined) child.stdin.end(options.input)
})

async function main() {
  const repository = required('repository')
  const pullNumber = Number(required('pull'))
  const configFile = resolve(required('config'))
  const runDir = resolve(arg('run-dir') ?? join(process.cwd(), '.agentskit', 'review-runs', `${Date.now()}-${pullNumber}`))
  const stateRoot = resolve(arg('state-dir') ?? join(dirname(runDir), 'state'))
  const runId = arg('run-id') ?? randomUUID()
  const provider = arg('provider') ?? 'codex-cli'
  const model = arg('model')
  const transport = arg('transport')
  const mode = arg('mode') ?? 'isolated'
  const batchSize = Number(arg('batch-size') ?? '5')
  const concurrency = Number(arg('concurrency') ?? '8')
  const batchConcurrency = Number(arg('batch-concurrency') ?? '2')
  const deadlineMs = Number(arg('deadline-ms') ?? '600000')
  const globalDeadlineMs = Number(arg('global-deadline-ms') ?? '1800000')
  const maxCalls = Number(arg('max-calls') ?? '1000')
  const maxTokens = Number(arg('max-tokens') ?? '10000000')
  const maxRetries = Number(arg('max-retries') ?? '1')
  const manifestFile = join(runDir, 'batch-manifest.json')
  const preflightFile = join(runDir, 'preflight.json')
  const contractFile = join(runDir, 'contract.json')
  const stateFile = join(runDir, 'state.json')
  const summaryFile = join(runDir, 'cycle-summary.json')
  const artifactsDir = join(runDir, 'batches')
  const summary = { version: 1, runId, decision: 'BLOCKED', phase: 'contract', libraryVersion: pkg.version, sourceRevision: 'unknown', repository, pullNumber, artifacts: {}, blockers: [], problems: [], fixes: [], cache: { hits: 0, misses: 0, corruptMisses: 0, staleMisses: 0, unvalidatedMisses: 0, savedTokens: 0 }, startedAt: new Date().toISOString() }
  const cycleStartedAt = Date.now()
  const remainingCycleMs = () => Math.max(0, globalDeadlineMs - (Date.now() - cycleStartedAt))
  mkdirSync(artifactsDir, { recursive: true })
  mkdirSync(stateRoot, { recursive: true })
  try {
    const gitRoot = safeExec('git', ['-C', root, 'rev-parse', '--show-toplevel']).stdout
    const sourceCheckout = gitRoot && resolve(gitRoot) === root
    const headRevision = sourceCheckout ? safeExec('git', ['-C', root, 'rev-parse', 'HEAD']).stdout : ''
    const sourceDiff = sourceCheckout ? safeExec('git', ['-C', root, 'diff', '--no-ext-diff', '--binary', 'HEAD']).stdout : ''
    const untracked = sourceCheckout ? safeExec('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z']).stdout.split('\0').filter(Boolean) : []
    const untrackedContent = untracked.map((file) => `${file}\0${readFileSync(join(root, file))}`).join('\0')
    const workingFingerprint = `${sourceDiff}\0${untrackedContent}`
    const sourceRevision = headRevision ? `${headRevision}${workingFingerprint !== '\0' ? `-dirty-${sha256(workingFingerprint)}` : ''}` : `npm-v${pkg.version}`
    summary.sourceRevision = sourceRevision
    const ghToken = process.env.GITHUB_TOKEN || safeExec('gh', ['auth', 'token']).stdout
    const childEnv = { ...process.env, ...(ghToken ? { GITHUB_TOKEN: ghToken } : {}) }
    const scmRef = { repository, id: String(pullNumber) }
    const github = ghToken ? createGithubScmAdapter({
      token: ghToken,
      command: async (command, args) => {
        const result = safeExec(command, [...args], { env: childEnv, timeout: 180_000 })
        if (!result.ok) throw new Error(result.stderr || result.stdout || `${command} failed`)
        return result
      },
    }) : undefined
    const checks = []
    checks.push(check('config.exists', existsSync(configFile), `configuration: ${configFile}`, 'provide an existing configuration file', configFile))
    checks.push(check('config.path', isAbsolute(configFile), 'configuration path is absolute', 'resolve the configuration path before execution', configFile))
    let projectConfig
    if (existsSync(configFile)) {
      try { projectConfig = (await loadProjectConfig(runDir, configFile)).config; checks.push(check('config.valid', true, 'configuration schema accepted', 'fix the configuration schema', configFile)) }
      catch (error) { checks.push(check('config.valid', false, 'configuration schema rejected', error instanceof Error ? error.message : String(error), configFile)) }
    }
    const schema = safeExec(process.execPath, [cli, '--config-schema'])
    checks.push(check('config.schema', schema.ok && schema.stdout.includes('AgentsKitCodeReviewConfig'), 'public configuration schema is available', 'repair the packaged configuration schema', schema.ok ? 'schema generated' : schema.stderr))
    const corpusFile = resolve(arg('quality-corpus') ?? join(root, 'quality/corpus/default.json'))
    const learningCorpusFile = resolve(arg('learning-corpus') ?? join(root, 'quality/learning/default.json'))
    let corpus
    try {
      corpus = readJson(corpusFile)
      checks.push(check('quality.corpus', corpus.version === 1 && Array.isArray(corpus.cases) && corpus.cases.length > 0, `quality corpus: ${corpusFile}`, 'provide a non-empty version 1 quality corpus', corpusFile))
    } catch (error) { checks.push(check('quality.corpus', false, `quality corpus: ${corpusFile}`, 'provide a readable JSON quality corpus', error instanceof Error ? error.message : String(error))) }
    let learningCorpus
    try {
      learningCorpus = readJson(learningCorpusFile)
      checks.push(check('quality.learning-corpus', learningCorpus.version === 1 && typeof learningCorpus.rule === 'string' && learningCorpus.case, `learning corpus: ${learningCorpusFile}`, 'provide a version 1 learning corpus with a rule and case', learningCorpusFile))
    } catch (error) { checks.push(check('quality.learning-corpus', false, `learning corpus: ${learningCorpusFile}`, 'provide a readable JSON learning corpus', error instanceof Error ? error.message : String(error))) }
    checks.push(check('input.repository', /^[^/\s]+\/[^/#\s]+$/.test(repository), `repository: ${repository}`, 'use owner/repository', repository))
    checks.push(check('input.pull', Number.isSafeInteger(pullNumber) && pullNumber > 0, `pull request: ${pullNumber}`, 'use a positive pull request number', String(pullNumber)))
    checks.push(check('input.mode', ['isolated', 'trusted-local'].includes(mode), `mode: ${mode}`, 'use isolated or trusted-local', mode))
    checks.push(check('input.batch-size', Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 100, `batch size: ${batchSize}`, 'use a batch size from 1 to 100', String(batchSize)))
    checks.push(check('input.concurrency', Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= 32, `provider concurrency: ${concurrency}`, 'use concurrency from 1 to 32', String(concurrency)))
    checks.push(check('input.batch-concurrency', Number.isSafeInteger(batchConcurrency) && batchConcurrency > 0 && batchConcurrency <= 8, `batch concurrency: ${batchConcurrency}`, 'use batch concurrency from 1 to 8', String(batchConcurrency)))
    checks.push(check('input.deadline', Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 1_800_000, `deadline: ${deadlineMs}ms`, 'use a deadline up to 1800000ms', String(deadlineMs)))
    checks.push(check('input.global-deadline', Number.isSafeInteger(globalDeadlineMs) && globalDeadlineMs >= deadlineMs && globalDeadlineMs <= 7_200_000, `global deadline: ${globalDeadlineMs}ms`, 'use a global deadline between the batch deadline and 7200000ms', String(globalDeadlineMs)))
    checks.push(check('input.max-calls', Number.isSafeInteger(maxCalls) && maxCalls > 0 && maxCalls <= 1000, `max calls: ${maxCalls}`, 'use max-calls from 1 to 1000', String(maxCalls)))
    checks.push(check('input.max-tokens', Number.isSafeInteger(maxTokens) && maxTokens > 0, `token budget: ${maxTokens}`, 'use a positive token budget', String(maxTokens)))
    checks.push(check('github.token', Boolean(ghToken), 'GitHub credential resolved without logging it', 'run gh auth login or inject GITHUB_TOKEN', ghToken ? 'credential present' : 'credential absent'))
    const auth = safeExec('gh', ['auth', 'status'], { env: childEnv })
    checks.push(check('github.auth', auth.ok, 'GitHub CLI authentication', 'run gh auth login', auth.ok ? 'gh auth status passed' : auth.stderr))
    const rate = safeExec('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining'], { env: childEnv })
    const remaining = Number(rate.stdout)
    checks.push(check('github.rate-limit', rate.ok && remaining >= 100, `GitHub core requests remaining: ${rate.stdout || 'unknown'}`, 'wait for reset or use a credential with sufficient quota', rate.ok ? rate.stdout : rate.stderr))
    const npmVersion = safeExec('npm', ['view', `@agentskit/code-review@${pkg.version}`, 'version'])
    checks.push(check('package.version', npmVersion.ok && npmVersion.stdout === pkg.version, `published package: ${npmVersion.stdout || 'unavailable'}, runner: ${pkg.version}`, 'publish and pin the exact runner version', npmVersion.ok ? npmVersion.stdout : npmVersion.stderr))
    const release = safeExec('gh', ['release', 'view', `v${pkg.version}`, '-R', 'AgentsKit-io/code-review', '--json', 'tagName', '--jq', '.tagName'], { env: childEnv })
    const releasePass = !has('merge') || (!sourceCheckout && npmVersion.ok && npmVersion.stdout === pkg.version && release.ok && release.stdout === `v${pkg.version}`)
    const providerArgs = [...(model ? ['--model', model] : []), ...(transport ? ['--transport', transport] : [])]
    const doctor = safeExec(process.execPath, [cli, 'doctor', '--provider', provider, '--mode', mode, ...providerArgs, '--json'], { env: childEnv })
    let doctorData
    try { doctorData = JSON.parse(doctor.stdout || '{}') } catch { /* reported as one blocker below */ }
    checks.push(check('provider.doctor', doctor.ok && doctorData?.ok === true, `${provider} static doctor`, 'install and authenticate the provider before review', doctor.ok ? doctor.stdout : doctor.stderr))
    if (provider === 'codex-cli') {
      const login = safeExec('codex', ['login', 'status'], { env: childEnv })
      const loginOutput = `${login.stdout ?? ''}\n${login.stderr ?? ''}`.trim()
      checks.push(check('provider.auth', login.ok && /logged in/i.test(loginOutput), 'Codex login status', 'run codex login before review', loginOutput))
    }
    if (has('merge')) {
      checks.push(check('merge.enabled', projectConfig?.merge.enabled === true, 'configuration permits merging', 'set merge.enabled only after validation is approved', String(projectConfig?.merge.enabled)))
      checks.push(check('merge.post', has('post'), 'merge requires posting the reviewed result', 'pass --post with --merge', String(has('post'))))
      checks.push(check('merge.admin-policy', !has('admin') || projectConfig?.merge.forbidAdmin === false, 'administrative merge policy', 'set merge.forbidAdmin=false before using --admin', String(projectConfig?.merge.forbidAdmin)))
    }
    const disk = statfsSync(runDir)
    const freeBytes = Number(disk.bavail) * Number(disk.bsize)
    checks.push(check('artifacts.disk', freeBytes >= 100 * 1024 * 1024, `free artifact storage: ${freeBytes} bytes`, 'free at least 100 MiB', String(freeBytes)))
    const stateDisk = statfsSync(stateRoot)
    checks.push(check('state.writable', Number(stateDisk.bavail) > 0, `persistent state root: ${stateRoot}`, 'use a writable persistent state directory', stateRoot))
    let prData
    let prError = 'GitHub token unavailable'
    try { if (github) prData = await github.metadata(scmRef) } catch (error) { prError = error instanceof Error ? error.message : String(error) }
    checks.push(check('pr.exists', Boolean(prData), `pull request ${repository}#${pullNumber}`, 'choose an accessible open pull request', prData ? `state=${prData.state}` : prError))
    checks.push(check('pr.open', prData?.state === 'open', `PR state: ${prData?.state ?? 'unknown'}`, 'choose an open pull request', prData?.state ?? 'missing'))
    checks.push(check('pr.not-draft', prData?.isDraft === false, `PR draft: ${String(prData?.isDraft)}`, 'choose a non-draft pull request', String(prData?.isDraft)))
    checks.push(check('pr.not-dependabot', prData?.author !== 'dependabot[bot]', `PR author: ${prData?.author ?? 'unknown'}`, 'choose a non-Dependabot pull request', prData?.author ?? 'missing'))
    checks.push(check('pr.not-fork', prData?.isFork === false, `PR fork: ${String(prData?.isFork)}`, 'choose an organization-owned pull request', String(prData?.isFork)))
    const firstSha = prData?.sourceRevision
    let stableSha
    try { if (github && firstSha) stableSha = (await github.metadata(scmRef)).sourceRevision } catch { /* collected below */ }
    checks.push(check('pr.stable-sha', Boolean(stableSha && stableSha === firstSha), `head SHA: ${firstSha ?? 'unknown'}`, 'restart after the PR head stabilizes', stableSha ?? 'head SHA unavailable'))

    const planPrerequisiteFailed = checks.some((item) => !item.ok && /^(?:config\.|input\.|github\.|pr\.)/.test(item.id))
    let plan
    if (!planPrerequisiteFailed) {
      const planRun = safeExec(process.execPath, [cli, '--config', configFile, '--pr', `${repository}#${pullNumber}`, '--provider', provider, '--mode', mode, ...providerArgs, '--profile', 'full', '--max-calls', String(maxCalls), '--concurrency', String(concurrency), '--deadline-ms', String(deadlineMs), '--health-check', 'off', '--plan', '--json', '--batch-size', String(batchSize), '--batch-manifest', manifestFile], { cwd: runDir, env: childEnv, timeout: 180_000 })
      try { plan = JSON.parse(planRun.stdout) } catch { /* collected below */ }
      checks.push(check('plan.complete', Boolean(planRun.ok && plan && existsSync(manifestFile)), 'complete provider-free plan and manifest', 'correct configuration, source limits, or budget before live execution', planRun.ok ? planRun.stdout : planRun.stderr))
      if (plan) {
        checks.push(check('plan.coverage', plan.unreviewedFiles === 0, `${plan.unreviewedFiles} unreviewed file(s)`, 'make every changed source format reviewable or explicitly exclude generated content', JSON.stringify(plan.unreviewed ?? [])))
        checks.push(check('plan.call-budget', plan.estimatedProviderCalls <= maxCalls, `${plan.estimatedProviderCalls}/${maxCalls} estimated provider calls`, 'increase bounded batches or reduce optional lenses/votes', String(plan.estimatedProviderCalls)))
        checks.push(check('plan.required-lenses', ['correctness', 'security', 'tests'].every((lens) => plan.requiredLenses?.includes(lens)), `required lenses: ${(plan.requiredLenses ?? []).join(', ')}`, 'enable correctness, security, and tests as required lenses', JSON.stringify(plan.requiredLenses)))
        if (existsSync(manifestFile)) {
          const plannedManifest = readJson(manifestFile)
          try {
            if (!github) throw new Error('GitHub SCM adapter unavailable')
            const reviewState = await github.reviewState(scmRef, plannedManifest.policyFingerprint)
            checks.push(check('pr.not-reviewed', !reviewState.alreadyPublished, 'same SHA and policy review marker', 'wait for a new SHA or change the review policy', String(reviewState.alreadyPublished)))
          } catch (error) { checks.push(check('pr.review-state', false, 'unable to prove GitHub review idempotency state', 'restore bounded GitHub comment-history access', error instanceof Error ? error.message : String(error))) }
        }
      }
    }
    shutdown.signal.throwIfAborted()
    const blockers = checks.filter((item) => !item.ok)
    const preflight = { status: blockers.length ? 'blocked' : 'ready', canStartLiveReview: blockers.length === 0, blockers, checks, contract: { runId, libraryVersion: pkg.version, sourceRevision, pr: `${repository}#${pullNumber}`, headSha: firstSha ?? null } }
    atomicJson(preflightFile, preflight)
    summary.artifacts.preflight = preflightFile
    if (blockers.length) { summary.blockers = blockers; summary.phase = 'preflight'; throw new Error(`preflight blocked: ${blockers.map((item) => item.id).join(', ')}`) }

    const manifest = readJson(manifestFile)
    if (!projectConfig) throw new Error('validated configuration unavailable')
    const configContent = readFileSync(configFile, 'utf8')
    const manifestFingerprint = sha256(readFileSync(manifestFile))
    const proposedContract = { version: 1, runId, libraryVersion: pkg.version, sourceRevision, repository, pullNumber, headSha: manifest.headSha, baseSha: prData.targetRevision, provider, model: model ?? null, transport: transport ?? null, mode, configFingerprint: sha256(configContent), qualityCorpusFingerprint: sha256(readFileSync(corpusFile)), learningCorpusFingerprint: sha256(readFileSync(learningCorpusFile)), policyFingerprint: manifest.policyFingerprint, manifestFingerprint, requiredLenses: plan.requiredLenses, retryLimit: maxRetries, maxCalls, maxTokens, deadlineMs, globalDeadlineMs, concurrency, batchConcurrency, runDir, stateRoot }
    const contract = existsSync(contractFile) ? readJson(contractFile) : { ...proposedContract, createdAt: new Date().toISOString() }
    for (const [key, value] of Object.entries(proposedContract)) if (JSON.stringify(contract[key]) !== JSON.stringify(value)) throw new Error(`existing contract mismatch: ${key}`)
    if (!existsSync(contractFile)) atomicJson(contractFile, contract)
    summary.artifacts.contract = contractFile
    summary.artifacts.manifest = manifestFile
    const reviewCache = createReviewCache(join(stateRoot, 'review-cache'))
    summary.artifacts.reviewCache = join(stateRoot, 'review-cache')
    const cacheIdentity = (batch) => ({
      sourceFingerprint: sha256(JSON.stringify({ headSha: manifest.headSha, files: batch.files })),
      diffFingerprint: sha256(JSON.stringify({ baseSha: prData.targetRevision, headSha: manifest.headSha, files: batch.files, manifestFingerprint })),
      baseFingerprint: sha256(prData.targetRevision),
      policyFingerprint: manifest.policyFingerprint,
      promptFingerprint: sha256(JSON.stringify({ config: contract.configFingerprint, packageVersion: pkg.version, profile: 'full', files: batch.files })),
      modelFingerprint: sha256(JSON.stringify({ provider, model: model ?? null, transport: transport ?? null })),
      knowledgeFingerprint: sha256(JSON.stringify({ learningCorpus: readFileSync(learningCorpusFile, 'utf8'), memory: projectConfig.memory })),
    })

    summary.phase = 'replay'
    const replay = safeExec(process.execPath, [harness, '--replay', '--report', join(runDir, 'replay.json')], { env: childEnv, timeout: Math.min(120_000, remainingCycleMs()) })
    summary.artifacts.replay = join(runDir, 'replay.json')
    if (!replay.ok) throw new Error(`replay blocked: ${replay.stderr || replay.stdout}`)

    const state = existsSync(stateFile) ? readJson(stateFile) : { version: 1, runId, sourceRevision, headSha: manifest.headSha, policyFingerprint: manifest.policyFingerprint, manifestFingerprint, stage: 'canary', completedBatches: [], attempts: {}, updatedAt: new Date().toISOString() }
    if (state.runId !== runId || state.sourceRevision !== sourceRevision || state.headSha !== manifest.headSha || state.policyFingerprint !== manifest.policyFingerprint || state.manifestFingerprint !== manifestFingerprint) throw new Error('existing run state does not match the locked contract')
    atomicJson(stateFile, state)
    summary.artifacts.state = stateFile

    const batchArgs = (index, artifact) => [cli, '--config', configFile, '--pr', `${repository}#${pullNumber}`, '--provider', provider, '--mode', mode, ...providerArgs, '--profile', 'full', '--batch-size', String(batchSize), '--batch-index', String(index), '--max-calls', String(maxCalls), '--concurrency', String(concurrency), '--deadline-ms', String(deadlineMs), '--health-check', 'off', '--no-fail', '--result', artifact]
    const validateArtifact = (artifact) => {
      if (!existsSync(artifact)) return { ready: false, blockers: [{ id: 'artifact.missing', message: artifact }] }
      try { return validateCanary(manifest, readJson(artifact)) } catch (error) { return { ready: false, blockers: [{ id: 'artifact.invalid', message: error.message }] } }
    }
    const runBatch = async (index, canary = false) => {
      const artifact = join(artifactsDir, `batch-${index}.json`)
      const metadataFile = join(artifactsDir, `batch-${index}.meta.json`)
      const batch = manifest.batches.find((candidate) => candidate.index === index)
      if (!batch) throw new Error(`batch ${index} is not present in the manifest`)
      const identity = cacheIdentity(batch)
      const cached = reviewCache.get(identity)
      if (cached.hit) {
        atomicJson(artifact, cached.record.value)
        const cachedValidation = validateArtifact(artifact)
        if (cachedValidation.ready) {
          summary.cache.hits += 1
          summary.cache.savedTokens += cached.record.tokenUsage.totalTokens
          return { index, artifact, reused: true, cacheHit: true, attempts: 0, savedTokens: cached.record.tokenUsage.totalTokens, validation: cachedValidation }
        }
        summary.cache.misses += 1
        summary.cache.corruptMisses += 1
      } else {
        summary.cache.misses += 1
        if (cached.reason === 'corrupt') summary.cache.corruptMisses += 1
        if (cached.reason === 'stale') summary.cache.staleMisses += 1
        if (cached.reason === 'unvalidated') summary.cache.unvalidatedMisses += 1
      }
      const existing = validateArtifact(artifact)
      let metadata
      try { metadata = readJson(metadataFile) } catch { /* invalid metadata forces a safe rerun */ }
      if (existing.ready && metadata?.sourceRevision === sourceRevision && metadata?.artifactHash === sha256(readFileSync(artifact))) return { index, artifact, reused: true, attempts: 0 }
      if (existsSync(artifact)) unlinkSync(artifact)
      if (existsSync(metadataFile)) unlinkSync(metadataFile)
      const limit = canary ? Math.max(1, maxRetries + 1) : Math.max(1, maxRetries + 1)
      let last
      for (let attempt = 1; attempt <= limit; attempt += 1) {
        state.attempts[index] = (state.attempts[index] ?? 0) + 1
        atomicJson(stateFile, { ...state, updatedAt: new Date().toISOString() })
        const remaining = remainingCycleMs()
        if (remaining <= 0) throw new Error(`global cycle deadline exceeded after ${globalDeadlineMs}ms`)
        const run = await processResult(process.execPath, batchArgs(index, artifact), { cwd: stateRoot, env: childEnv, timeout: Math.min(deadlineMs + 60_000, remaining) })
        const validation = validateArtifact(artifact)
        last = { index, artifact, attempts: attempt, exitCode: run.code, timedOut: run.timedOut, validation, stderr: run.stderr.slice(-4000) }
        atomicJson(join(runDir, `batch-${index}-attempt-${attempt}.json`), last)
        if (validation.ready) {
          atomicJson(metadataFile, { version: 1, runId, sourceRevision, artifactHash: sha256(readFileSync(artifact)) })
          const review = readJson(artifact).review
          reviewCache.set(identity, {
            provenance: { repository, pullNumber, unitId: `batch-${index}`, sourceFiles: batch.files, sourceRevision: manifest.headSha, createdAt: new Date().toISOString() },
            tokenUsage: { totalTokens: Number(review?.evidence?.tokensUsed ?? 0), providerCalls: Number(review?.evidence?.providerCalls ?? 0) },
            validation: { status: 'passed', checkedAt: new Date().toISOString(), evidenceFingerprint: sha256(JSON.stringify(review?.evidence ?? {})) },
            value: readJson(artifact),
          })
          return last
        }
        const transient = run.timedOut || /(?:timeout|timed out|ECONNRESET|429|5\d\d|temporar|rate limit)/i.test(run.stderr)
        if (!transient) break
      }
      throw new Error(`batch ${index} blocked: ${JSON.stringify(last)}`)
    }

    summary.phase = 'canary'
    const canary = await runBatch(manifest.batches[0].index, true)
    state.completedBatches = [...new Set([...state.completedBatches, canary.index])].sort((a, b) => a - b)
    state.stage = 'full-review'; atomicJson(stateFile, { ...state, updatedAt: new Date().toISOString() })
    summary.artifacts.canary = canary.artifact
    if (!corpus) throw new Error('validated quality corpus unavailable')
    const evaluation = await runQualityCorpus(corpus, { cli, configFile, provider, mode, providerArgs, qualityVotes: projectConfig.review.votes, maxCalls, concurrency, deadlineMs, runDir, stateRoot, childEnv, remainingCycleMs })
    summary.artifacts.qualityEvaluation = evaluation.file
    if (!learningCorpus) throw new Error('validated learning corpus unavailable')
    const learning = await runLearningEvaluation(learningCorpus, projectConfig, { cli, provider, mode, providerArgs, maxCalls, concurrency, deadlineMs, runDir, childEnv, remainingCycleMs })
    summary.artifacts.learningEvaluation = learning.file
    const changedLines = Number(prData.additions ?? 0) + Number(prData.deletions ?? 0)
    const pilotInput = qualityInput({ runId, version: pkg.version, sourceRevision, repository, pullNumber, manifest, artifacts: [readJson(canary.artifact)], changedLines, elapsedBaseline: undefined, baselineTokensPerChangedLine: undefined, memory: { enabled: projectConfig.memory.enabled, persistencePass: false, loadPass: false, malformedRejected: false, feedbackRecorded: false, rulesApproved: false, learningEvaluationPass: false, learningDetectionLift: false, learningPrecisionPass: false, learningTokenPass: false }, evaluation, integration: { githubPass: true, orcaPass: false, releasePass: false, mergeSafetyPass: true } })
    const pilotReport = evaluateQuality(pilotInput)
    atomicJson(join(runDir, 'quality-pilot.json'), { ...pilotReport, target: `${repository}#${pullNumber}`, headSha: manifest.headSha, configFingerprint: contract.configFingerprint, manifestFingerprint, evidencePaths: [canary.artifact, evaluation.file] })
    summary.artifacts.qualityPilot = join(runDir, 'quality-pilot.json')

    summary.phase = 'full-review'
    const pending = manifest.batches.map((batch) => batch.index).filter((index) => !state.completedBatches.includes(index))
    const queue = [...pending]
    const workers = Array.from({ length: Math.min(batchConcurrency, queue.length) }, async () => {
      while (queue.length) {
        const index = queue.shift()
        const result = await runBatch(index)
        state.completedBatches = [...new Set([...state.completedBatches, result.index])].sort((a, b) => a - b)
        atomicJson(stateFile, { ...state, updatedAt: new Date().toISOString() })
      }
    })
    await Promise.all(workers)
    if (state.completedBatches.length !== manifest.batches.length) throw new Error(`full review incomplete: ${state.completedBatches.length}/${manifest.batches.length} batches`)

    summary.phase = 'consolidation'
    const artifactFiles = manifest.batches.map((batch) => join(artifactsDir, `batch-${batch.index}.json`))
    const consolidatedFile = join(runDir, 'consolidated.json')
    const consolidation = safeExec(process.execPath, [cli, '--consolidate-manifest', manifestFile, '--artifacts', artifactFiles.join(','), '--result', consolidatedFile], { cwd: runDir, env: childEnv, timeout: 120_000 })
    if (!consolidation.ok) throw new Error(`consolidation blocked: ${consolidation.stderr || consolidation.stdout}`)
    const consolidated = readJson(consolidatedFile)
    summary.artifacts.consolidated = consolidatedFile
    const memory = await validateMemory(projectConfig, runDir, stateRoot, consolidated, contract, learning)
    summary.artifacts.memory = memory.evidenceFile

    summary.phase = 'quality'
    const baselineFile = arg('quality-baseline')
    const baselineArtifact = baselineFile ? readJson(resolve(baselineFile)) : undefined
    const baselineInput = baselineArtifact?.rawInput ?? (baselineArtifact?.areas ? undefined : baselineArtifact)
    const baselineArea = (area) => baselineArtifact?.areas?.find((item) => item.area === area)?.metrics
    const reviews = artifactFiles.map(readJson)
    const baselineTokensPerChangedLine = baselineInput?.tokens?.tokensUsed !== undefined && baselineInput.tokens.changedLines > 0
      ? baselineInput.tokens.tokensUsed / baselineInput.tokens.changedLines
      : baselineArea('token-efficiency')?.tokensPerChangedLine
    const orcaPass = validateOrcaEvidence(arg('orca-evidence'), { runId, sourceRevision, libraryVersion: pkg.version })
    const mergeSafetyPass = !has('merge') || (projectConfig.merge.enabled && has('post') && (!has('admin') || !projectConfig.merge.forbidAdmin))
    const serializedArtifacts = artifactFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
    const artifactMetaValid = artifactFiles.every((file, index) => {
      try { const metadata = readJson(join(artifactsDir, `batch-${index}.meta.json`)); return metadata.sourceRevision === sourceRevision && metadata.artifactHash === sha256(readFileSync(file)) } catch { return false }
    })
    const input = qualityInput({ runId, version: pkg.version, sourceRevision, repository, pullNumber, manifest, artifacts: reviews, changedLines, elapsedBaseline: baselineInput?.performance?.p95Ms ?? baselineArea('speed')?.p95Ms, baselineTokensPerChangedLine, memory, evaluation, cache: summary.cache, evidence: { checks, replay: readJson(summary.artifacts.replay), state, artifactMetaValid, secretLeaks: ghToken && serializedArtifacts.includes(ghToken) ? 1 : 0, maxCalls, maxTokens }, integration: { githubPass: true, orcaPass, releasePass, mergeSafetyPass } })
    atomicJson(join(runDir, 'quality-input.json'), input)
    const baselineReport = baselineArtifact?.areas ? baselineArtifact : baselineInput ? evaluateQuality(baselineInput) : undefined
    const quality = baselineReport ? evaluateQualityAgainstBaseline(input, baselineReport) : evaluateQuality(input)
    const comparison = baselineReport ? compareQuality(quality, baselineReport) : { regressions: [], materialRegressions: [], improved: [] }
    const unresolvedGaps = quality.areas.filter((area) => area.status !== 'passed').map((area) => area.area)
    const matrix = { ...quality, target: `${repository}#${pullNumber}`, headSha: manifest.headSha, configFingerprint: contract.configFingerprint, manifestFingerprint, evidencePaths: [...artifactFiles, evaluation.file, memory.evidenceFile].filter(Boolean), rawInput: input, baseline: baselineFile ? { path: resolve(baselineFile), runId: baselineArtifact?.runId ?? null, version: baselineArtifact?.libraryVersion ?? baselineArtifact?.version ?? null } : null, comparison, regressions: comparison.regressions, improvements: comparison.improved, unresolvedGaps }
    atomicJson(join(runDir, 'quality-report.json'), matrix)
    const matrixFile = join(runDir, 'quality', 'matrices', `v${pkg.version}-${runId}.json`)
    atomicJson(matrixFile, matrix)
    summary.artifacts.matrix = matrixFile
    summary.artifacts.qualityReport = join(runDir, 'quality-report.json')
    state.stage = quality.decision === 'PASS' ? 'complete' : 'quality'; atomicJson(stateFile, { ...state, updatedAt: new Date().toISOString() })

    if (has('post')) {
      if (quality.decision !== 'PASS') throw new Error('posting forbidden because the quality matrix is BLOCKED')
      const post = safeExec(process.execPath, [cli, '--config', configFile, '--pr', `${repository}#${pullNumber}`, '--provider', provider, '--mode', mode, ...providerArgs, '--profile', 'full', '--max-calls', String(maxCalls), '--concurrency', String(concurrency), '--deadline-ms', String(deadlineMs), '--publish-result', consolidatedFile, '--post', '--no-fail'], { cwd: runDir, env: childEnv, timeout: 180_000 })
      if (!post.ok) throw new Error(`posting blocked: ${post.stderr || post.stdout}`)
      summary.artifacts.post = 'github'
    }
    if (has('merge')) {
      if (!has('post') || quality.decision !== 'PASS') throw new Error('merge forbidden: posting and quality PASS are required')
      if (consolidated.review.verdict !== 'APPROVE') summary.artifacts.merge = 'skipped:review-findings'
      else {
        if (!github) throw new Error('merge blocked: GitHub SCM adapter unavailable')
        const readiness = await github.mergeReadiness(scmRef, projectConfig.checks)
        if (!readiness.ready || readiness.headRevision !== manifest.headSha) throw new Error(`merge gate blocked: sha=${readiness.headRevision}; blockers=${readiness.blockers.join(', ')}`)
        await github.merge(scmRef, { expectedHeadRevision: manifest.headSha, method: projectConfig.merge.method, admin: has('admin') })
        summary.artifacts.merge = 'github'
      }
    }

    summary.decision = quality.decision === 'PASS' ? 'COMPLETE' : 'BLOCKED'
    summary.phase = quality.decision === 'PASS' ? 'complete' : 'quality'
    summary.qualityDecision = quality.decision
    summary.fullReview = { batches: manifest.batches.length, completed: state.completedBatches.length, files: manifest.batches.reduce((count, batch) => count + batch.files.length, 0), verdict: consolidated.review.verdict, findings: consolidated.review.findings.length, tokensUsed: consolidated.review.evidence.tokensUsed, cache: summary.cache }
    if (quality.decision !== 'PASS') summary.blockers = quality.areas.filter((area) => area.status !== 'passed').map((area) => ({ id: `quality.${area.area}`, message: area.reason, evidence: area.metrics }))
  } catch (error) {
    summary.problems.push(error instanceof Error ? error.message : String(error))
  } finally {
    summary.finishedAt = new Date().toISOString()
    atomicJson(summaryFile, summary)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  }
  process.exitCode = summary.decision === 'COMPLETE' ? 0 : 2
}

async function runLearningEvaluation(corpus, projectConfig, options) {
  if (corpus?.version !== 1 || typeof corpus.rule !== 'string' || !corpus.case) throw new Error('learning corpus is malformed')
  const directory = join(options.runDir, 'learning-evaluation')
  const memoryPath = '.agentskit/learning/messages.json'
  mkdirSync(directory, { recursive: true })
  const withMemoryConfig = join(directory, 'with-memory.json')
  const withoutMemoryConfig = join(directory, 'without-memory.json')
  atomicJson(withMemoryConfig, { ...projectConfig, memory: { ...projectConfig.memory, enabled: true, provider: 'self-hosted', path: memoryPath, autoPromoteRules: false } })
  atomicJson(withoutMemoryConfig, { ...projectConfig, memory: { ...projectConfig.memory, enabled: false, autoPromoteRules: false } })
  await createReviewKnowledgeStore(join(directory, memoryPath), projectConfig.memory.retentionDays).saveApprovedRule({ rule: corpus.rule })
  const fixture = { version: 1, cases: [corpus.case] }
  const common = { cli: options.cli, provider: options.provider, mode: options.mode, providerArgs: options.providerArgs, maxCalls: options.maxCalls, concurrency: options.concurrency, deadlineMs: options.deadlineMs, stateRoot: directory, childEnv: options.childEnv, remainingCycleMs: options.remainingCycleMs }
  const withMemory = await runQualityCorpus(fixture, { ...common, configFile: withMemoryConfig, runDir: join(directory, 'with-memory') })
  const withoutMemory = await runQualityCorpus(fixture, { ...common, configFile: withoutMemoryConfig, runDir: join(directory, 'without-memory') })
  const expected = corpus.case.findings.length
  const tokenRatio = withoutMemory.tokensUsed > 0 ? withMemory.tokensUsed / withoutMemory.tokensUsed : null
  const withMemoryCalls = withMemory.providerCalls
  const withoutMemoryCalls = withoutMemory.providerCalls
  const tokenPerCallRatio = withoutMemoryCalls > 0 && withoutMemory.tokensUsed > 0
    ? (withMemory.tokensUsed / withMemoryCalls) / (withoutMemory.tokensUsed / withoutMemoryCalls)
    : null
  const result = {
    version: 1,
    approvedRuleApplied: withMemory.metrics.detectedExpected === expected,
    detectionLift: withMemory.metrics.detectedExpected > withoutMemory.metrics.detectedExpected,
    precisionPass: withMemory.metrics.falsePositives === 0 && withMemory.metrics.duplicates === 0,
    tokenPass: tokenPerCallRatio !== null && tokenPerCallRatio <= 1.1,
    tokenRatio,
    tokenPerCallRatio,
    withMemory: { metrics: withMemory.metrics, tokensUsed: withMemory.tokensUsed, providerCalls: withMemoryCalls, artifact: withMemory.file },
    withoutMemory: { metrics: withoutMemory.metrics, tokensUsed: withoutMemory.tokensUsed, providerCalls: withoutMemoryCalls, artifact: withoutMemory.file },
  }
  const pass = result.approvedRuleApplied && result.detectionLift && result.precisionPass && result.tokenPass
  const file = join(directory, 'learning-report.json')
  atomicJson(file, { ...result, pass })
  return { ...result, pass, file }
}

async function validateMemory(config, runDir, stateRoot, consolidated, contract, learning) {
  const disabled = { enabled: false, persistencePass: false, loadPass: false, malformedRejected: false, feedbackRecorded: false, rulesApproved: false, learningEvaluationPass: false, learningDetectionLift: false, learningPrecisionPass: false, learningTokenPass: false, evidenceFile: null }
  if (!config.memory.enabled || config.memory.provider !== 'self-hosted') return disabled
  const configured = join(stateRoot, config.memory.path)
  const memoryFile = extname(configured).toLowerCase() === '.json' ? configured : join(configured, 'messages.json')
  const store = createReviewKnowledgeStore(memoryFile, config.memory.retentionDays)
  let knowledge = []
  let loadPass = false
  try { knowledge = await store.load(); loadPass = true } catch { /* reported below */ }
  const malformed = join(runDir, '.agentskit', 'malformed-memory.json')
  atomicJson(malformed, { version: 999, messages: [] })
  let malformedRejected = false
  try { await createReviewKnowledgeStore(malformed).load() } catch { malformedRejected = true }
  unlinkSync(malformed)
  const feedbackFile = join(dirname(memoryFile), 'feedback.json')
  const feedbackStore = createReviewFeedbackStore(feedbackFile, config.memory.retentionDays)
  let feedback = []
  try { feedback = await feedbackStore.load() } catch (error) { throw new Error(`feedback store is malformed: ${error instanceof Error ? error.message : String(error)}`) }
  if (config.feedback.enabled && config.memory.learnFromFeedback && !feedback.some((entry) => entry.runId === contract.runId)) {
    for (const finding of consolidated.review.findings) await feedbackStore.append({ runId: contract.runId, repository: contract.repository, pullNumber: contract.pullNumber, headSha: contract.headSha, finding: { file: finding.file, line: finding.line, title: finding.title, status: 'pending' } })
    feedback = await feedbackStore.load()
  }
  const reconciliationStore = createReviewReconciliationStore(join(dirname(memoryFile), 'reconciliation.json'))
  const reconciliation = reconcileReviewFeedback(feedback, await reconciliationStore.load())
  await reconciliationStore.save(reconciliation)
  const historyFile = join(dirname(memoryFile), 'validation-history.json')
  let history = { version: 1, runs: [] }
  if (existsSync(historyFile)) history = readJson(historyFile)
  if (history.version !== 1 || !Array.isArray(history.runs)) throw new Error('memory validation history has an unsupported format')
  const previous = history.runs.at(-1)
  history.runs.push({ runId: contract.runId, messageCount: knowledge.length })
  atomicJson(historyFile, { ...history, runs: history.runs.slice(-50) })
  const evidence = {
    enabled: true,
    persistencePass: existsSync(memoryFile) && knowledge.length >= 1 && (!previous || knowledge.length >= previous.messageCount),
    loadPass,
    malformedRejected,
    feedbackRecorded: !config.feedback.enabled || consolidated.review.findings.length === 0 || feedback.some((entry) => entry.runId === contract.runId),
    rulesApproved: config.feedback.requireApprovalForRules && config.memory.autoPromoteRules === false && learning.approvedRuleApplied,
    learningEvaluationPass: learning.pass,
    learningDetectionLift: learning.detectionLift,
    learningPrecisionPass: learning.precisionPass,
    learningTokenPass: learning.tokenPass,
    evidenceFile: join(runDir, 'memory-evidence.json'),
  }
  atomicJson(evidence.evidenceFile, { ...evidence, memoryFile, knowledgeCount: knowledge.length, feedbackFile, feedbackEntries: feedback.length, previousRun: previous?.runId ?? null, historyFile, learningEvaluation: learning.file, reconciliation: { metrics: reconciliation.metrics, candidateIds: reconciliation.candidates.map((candidate) => candidate.id) }, reconciliationFile: reconciliationStore.path })
  return evidence
}

function qualityInput({ runId, version, sourceRevision, repository, pullNumber, manifest, artifacts, changedLines, elapsedBaseline, baselineTokensPerChangedLine, memory, evaluation, cache, evidence = {}, integration }) {
  const reviews = artifacts.map((artifact) => artifact.review)
  const files = manifest.batches.reduce((count, batch) => count + batch.files.length, 0)
  const requiredLenses = 3
  const elapsedValues = reviews.map((review) => review.evidence.elapsedMs).sort((a, b) => a - b)
  const elapsed = elapsedValues[Math.max(0, Math.ceil(elapsedValues.length * 0.95) - 1)] ?? 0
  const tokensUsed = reviews.every((review) => Number.isFinite(review.evidence.tokensUsed)) ? reviews.reduce((total, review) => total + review.evidence.tokensUsed, 0) : undefined
  const unreviewedFiles = reviews.reduce((total, review) => total + (review.unreviewed?.length ?? 0), 0)
  const complete = reviews.every((review) => !review.incomplete && !review.evidence.deadlineExceeded && review.execution.failed === 0 && !(review.missingRequiredLenses?.length))
  const replayPass = evidence.replay?.status === 'ready'
  const configCheck = evidence.checks?.find((item) => item.id === 'config.valid')
  const schemaCheck = evidence.checks?.find((item) => item.id === 'config.schema')
  const retries = Object.values(evidence.state?.attempts ?? {}).reduce((total, attempts) => total + Math.max(0, Number(attempts) - 1), 0)
  const providerCalls = reviews.reduce((total, review) => total + review.evidence.providerCalls, 0) + evaluation.cases.reduce((total, item) => total + item.review.evidence.providerCalls, 0)
  const wastedCalls = reviews.reduce((total, review) => total + review.evidence.failedProviderCalls + review.evidence.skippedProviderCalls, 0) + evaluation.cases.reduce((total, item) => total + item.review.evidence.failedProviderCalls + item.review.evidence.skippedProviderCalls, 0)
  const accountingFields = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'memoryTokens', 'retryTokens', 'providerCalls', 'wallClockMs']
  const accounting = Object.fromEntries(accountingFields.flatMap((field) => {
    const values = reviews.map((review) => review.evidence.usage?.[field])
    return values.length && values.every((value) => Number.isFinite(value)) ? [[field, values.reduce((total, value) => total + value, 0)]] : []
  }))
  return {
    runId, version, sourceRevision,
    coverage: { eligibleFiles: files, reviewedFiles: complete ? files - unreviewedFiles : 0, unreviewedFiles, requiredLensRuns: files * requiredLenses, completedRequiredLensRuns: complete ? files * requiredLenses : 0 },
    findings: evaluation.metrics,
    comments: evaluation.comments,
    security: { secretLeaks: evidence.secretLeaks ?? 0, unsafeActions: 0, failClosedViolations: replayPass ? 0 : 1 },
    reliability: { runs: 1, completeRuns: complete ? 1 : 0, incompleteAccepted: complete ? 0 : 1, staleArtifactsAccepted: evidence.artifactMetaValid === false ? 1 : 0, silentFailures: reviews.some((review) => review.execution.failed > 0 && !review.incomplete) ? 1 : 0 },
    performance: { p95Ms: elapsed, wallClockMs: reviews.reduce((total, review) => total + review.evidence.elapsedMs, 0), ...(elapsedBaseline ? { baselineP95Ms: elapsedBaseline } : {}) },
    tokens: { ...(tokensUsed === undefined ? {} : { tokensUsed }), changedLines, validFindings: evaluation.metrics.detectedExpected, ...(baselineTokensPerChangedLine ? { baselineTokensPerChangedLine } : {}), ...(Object.keys(accounting).length ? { accounting } : {}) },
    batches: { planned: manifest.batches.length, completed: artifacts.length, retried: retries, wastedCalls, providerCalls, overBudget: providerCalls > (evidence.maxCalls ?? Infinity) || (tokensUsed ?? Infinity) + evaluation.tokensUsed > (evidence.maxTokens ?? Infinity) ? 1 : 0 },
    ...(cache ? { cache } : {}),
    memory: { enabled: memory.enabled, persistencePass: memory.persistencePass, loadPass: memory.loadPass, malformedRejected: memory.malformedRejected, feedbackRecorded: memory.feedbackRecorded, rulesApproved: memory.rulesApproved, learningEvaluationPass: memory.learningEvaluationPass, learningDetectionLift: memory.learningDetectionLift, learningPrecisionPass: memory.learningPrecisionPass, learningTokenPass: memory.learningTokenPass },
    configuration: { validAccepted: configCheck?.ok === true, invalidRejected: replayPass, schemaAvailable: schemaCheck?.ok === true },
    integration,
    evidence: { kind: 'real-run', repository, pullNumber, headSha: manifest.headSha },
  }
}

function scoreGroundTruth(actual, groundTruth) {
  if (!Array.isArray(groundTruth)) throw new Error('ground truth must contain a findings array')
  const matched = new Set()
  let severityMatches = 0
  let severityWithinOne = 0
  const severityRank = ['blocker', 'high', 'med', 'nit']
  const matches = (finding, expected) => Math.abs(finding.line - expected.line) <= (expected.lineTolerance ?? 5) && (!expected.category || finding.category === expected.category) && (!expected.titleIncludes || expected.titleIncludes.some((term) => finding.title.toLowerCase().includes(String(term).toLowerCase())))
  for (const expected of groundTruth) {
    const index = actual.findIndex((finding, candidate) => !matched.has(candidate) && matches(finding, expected))
    if (index < 0) continue
    matched.add(index)
    if (actual[index].severity === expected.severity) severityMatches += 1
    if (Math.abs(severityRank.indexOf(actual[index].severity) - severityRank.indexOf(expected.severity)) <= 1) severityWithinOne += 1
  }
  const duplicates = actual.filter((finding, index) => !matched.has(index) && groundTruth.some((expected) => matches(finding, expected))).length
  return {
    expected: groundTruth.length,
    detectedExpected: matched.size,
    falsePositives: actual.length - matched.size - duplicates,
    duplicates,
    severityMatches,
    severityWithinOne,
    severityTotal: matched.size,
    actionable: actual.filter((finding) => finding.rationale && finding.suggestion).length,
    detected: actual.length,
  }
}

async function runQualityCorpus(corpus, options) {
  if (corpus?.version !== 1 || !Array.isArray(corpus.cases) || corpus.cases.length === 0) throw new Error('quality corpus must contain at least one version 1 case')
  const results = []
  for (const testCase of corpus.cases) {
    if (!testCase.id || !testCase.source || !Array.isArray(testCase.findings)) throw new Error('quality corpus case is malformed')
    const resultFile = join(options.runDir, 'quality-evaluation', `${testCase.id}.json`)
    mkdirSync(dirname(resultFile), { recursive: true })
    const remaining = options.remainingCycleMs()
    if (remaining <= 0) throw new Error(`global cycle deadline exceeded before quality case ${testCase.id}`)
    const run = await processResult(process.execPath, [options.cli, '--config', options.configFile, '--provider', options.provider, '--mode', options.mode, ...options.providerArgs, '--profile', 'fast', ...(options.qualityVotes ? ['--votes', String(options.qualityVotes)] : []), '--stdin', '--lang', testCase.language ?? 'ts', '--max-findings-per-file', '1', '--max-calls', String(options.maxCalls), '--concurrency', String(options.concurrency), '--deadline-ms', String(options.deadlineMs), '--health-check', 'off', '--no-fail', '--result', resultFile], { cwd: options.stateRoot, env: options.childEnv, timeout: Math.min(options.deadlineMs + 60_000, remaining), input: testCase.source })
    if (run.code !== 0 || !existsSync(resultFile)) throw new Error(`quality corpus ${testCase.id} failed: ${run.stderr || run.stdout}`)
    const review = readJson(resultFile)
    if (review.incomplete || review.evidence?.deadlineExceeded || review.execution?.failed) throw new Error(`quality corpus ${testCase.id} returned incomplete evidence`)
    results.push({ id: testCase.id, expected: testCase.findings, review })
  }
  const actual = results.flatMap((item) => item.review.findings)
  const expected = results.flatMap((item) => item.expected)
  const metrics = scoreGroundTruth(actual, expected)
  const comments = { inlineExpected: metrics.detectedExpected, inlineValid: metrics.detectedExpected, actionable: metrics.actionable, total: metrics.detected }
  const tokensUsed = results.reduce((total, item) => total + (item.review.evidence.tokensUsed ?? 0), 0)
  const providerCalls = results.reduce((total, item) => total + (item.review.evidence.providerCalls ?? 0), 0)
  const file = join(options.runDir, 'quality-evaluation.json')
  atomicJson(file, { version: 1, corpusVersion: corpus.version, cases: results, metrics, comments, tokensUsed })
  return { file, cases: results, metrics, comments, tokensUsed, providerCalls }
}

function validateOrcaEvidence(file, expected) {
  if (!file) return false
  try {
    const evidence = readJson(resolve(file))
    return evidence.version === 1 && evidence.status === 'passed' && evidence.runId === expected.runId && evidence.sourceRevision === expected.sourceRevision && evidence.libraryVersion === expected.libraryVersion && typeof evidence.automationId === 'string' && evidence.automationId.length > 0
  } catch { return false }
}

main().catch((error) => { console.error(error); process.exitCode = 2 }).finally(() => {
  process.removeListener('SIGINT', requestShutdown)
  process.removeListener('SIGTERM', requestShutdown)
})
