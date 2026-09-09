import { execFile } from 'node:child_process'
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { ReviewTarget } from './agent.js'
import { redactSecrets } from '../../src/local-cli-process.js'
import { createGithubScmAdapter } from '../../src/github-scm-adapter.js'
import type { ChangeRequestDiff, ChangeRequestRef, ScmAdapter } from '../../src/scm-contract.js'

const run = promisify(execFile)
const DEFAULT_SNAPSHOT_FILES = 100
const DEFAULT_TOTAL_BYTES = 5 * 1024 * 1024
const DEFAULT_PROMPT_FILE_BYTES = 256 * 1024
const ABSOLUTE_SNAPSHOT_FILES = 500
const ABSOLUTE_TOTAL_BYTES = 25 * 1024 * 1024
const ABSOLUTE_PROMPT_FILE_BYTES = 1024 * 1024
const DEFAULT_GITHUB_PR_FILES = 40
const MAX_GITHUB_PR_METADATA_FILES = 500

export type ContextMode = 'prompt' | 'isolated-snapshot'
export interface SourceLimits {
  readonly maxFiles?: number
  readonly maxBytes?: number
  readonly maxFileBytes?: number
  readonly contextLines?: number
}

export type SourceConfig =
  | { kind: 'git-diff'; base: string; head?: string; cwd?: string; redact?: boolean; limits?: SourceLimits }
  | { kind: 'scm'; adapter: ScmAdapter; ref: ChangeRequestRef; diff?: ChangeRequestDiff; baselineRevision?: string; collectErrors?: boolean; redact?: boolean; limits?: SourceLimits }
  | { kind: 'github-pr'; owner: string; repo: string; number: number; token: string; baselineSha?: string; redact?: boolean; limits?: SourceLimits; adapter?: ScmAdapter }
  | { kind: 'paths'; paths: string[]; cwd?: string; redact?: boolean; limits?: SourceLimits }
  | { kind: 'stdin'; content: string; filename?: string; redact?: boolean; limits?: SourceLimits }
  | { kind: 'isolated-snapshot'; cwd: string; patterns: string[]; redact?: boolean; limits?: SourceLimits }

const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.c', '.h', '.cpp', '.hpp',
  '.swift', '.scala', '.sql', '.sh', '.vue', '.svelte', '.html', '.css', '.md', '.mdx', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml',
  '.graphql', '.gql', '.tf', '.tfvars', '.hcl', '.tsv',
])
const SPECIAL_FILES = new Set(['Dockerfile', 'Containerfile', 'Makefile', 'Jenkinsfile', 'Procfile', 'llms.txt', 'llms-full.txt', 'gitignore', 'dockerignore', 'npmignore', 'eslintignore', 'prettierignore', 'env.example', 'env.sample', 'env.template', ' justfile '].map((name) => name.trim()))
const DENY_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out', 'vendor'])
const DENY_FILE = /^(?:\.env(?!\.(?:example|sample|template)$)(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:key|pem|crt|cer|p12|pfx))$/i

const langOf = (file: string): string => {
  const base = file.split('/').pop() ?? file
  if (SPECIAL_FILES.has(base) || base.startsWith('.github/')) return base.toLowerCase().includes('docker') ? 'dockerfile' : 'config'
  return extname(file).replace('.', '') || 'text'
}

function normalize(file: string): string { return file.replaceAll('\\', '/') }

function promptText(content: string): string | undefined {
  let nul = 0; let controls = 0
  for (const character of content) {
    const code = character.charCodeAt(0)
    if (code === 0) nul += 1
    else if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffd) controls += 1
    if (nul > 8 || controls > 8) return undefined
  }
  return content.replaceAll('\0', '\\0')
}

function deniedPath(file: string): string | undefined {
  const parts = normalize(file).split('/')
  if (parts.some((part) => DENY_DIRS.has(part))) return 'sensitive or generated directory'
  if (DENY_FILE.test(parts.at(-1) ?? '')) return 'sensitive file'
  return undefined
}

function isReviewableName(file: string): boolean {
  const base = file.split('/').pop() ?? file
  return SPECIAL_FILES.has(base) || SPECIAL_FILES.has(base.replace(/^\./, '')) || CODE_EXT.has(extname(file).toLowerCase()) || normalize(file).startsWith('.github/workflows/')
}

type PatchRecord = { line: number; kind: 'context' | 'added' | 'removed'; content: string }
type PatchInfo = { records: PatchRecord[]; changedRanges: Array<{ start: number; end: number }> }

function rangesFromLines(lines: readonly number[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const previous = ranges.at(-1)
    if (previous && line === previous.end + 1) previous.end = line
    else ranges.push({ start: line, end: line })
  }
  return ranges
}

function parsePatch(patch: string): PatchInfo {
  const records: PatchRecord[] = []
  const changedLines: number[] = []
  let line = 0
  let inHunk = false
  for (const value of patch.split('\n')) {
    const header = value.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (header) { line = Number(header[1]); inHunk = true; continue }
    if (!inHunk || value.startsWith('\\ No newline')) continue
    if (value.startsWith('+')) {
      records.push({ line, kind: 'added', content: value.slice(1) })
      changedLines.push(line++)
    } else if (value.startsWith('-')) {
      const anchor = Math.max(1, line)
      records.push({ line: anchor, kind: 'removed', content: value.slice(1) })
      changedLines.push(anchor)
    } else if (value.startsWith(' ')) {
      records.push({ line, kind: 'context', content: value.slice(1) })
      line += 1
    }
  }
  return { records, changedRanges: rangesFromLines(changedLines) }
}

function changedRanges(patch: string): Array<{ start: number; end: number }> {
  return parsePatch(patch).changedRanges
}

function mergeRanges(ranges: readonly { start: number; end: number }[], maxLine: number, adjacentLines: number): Array<{ start: number; end: number }> {
  const expanded = ranges
    .map(({ start, end }) => ({ start: Math.max(1, start - adjacentLines), end: Math.min(maxLine, end + adjacentLines) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Array<{ start: number; end: number }> = []
  for (const range of expanded) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

function actualAdjacentLines(lines: readonly number[], changed: readonly { start: number; end: number }[]): number {
  return lines.reduce((maximum, line) => Math.max(maximum, Math.min(...changed.map((range) => line < range.start ? range.start - line : line > range.end ? line - range.end : 0))), 0)
}

type ProjectedSource = { fullContent: string; sourceLineNumbers?: number[]; contextProjection: NonNullable<ReviewTarget['contextProjection']> }

function projectChangedContent(content: string, patch: PatchInfo, adjacentLines: number): ProjectedSource {
  const lines = content.split('\n')
  if (!patch.changedRanges.length) return {
    fullContent: content,
    contextProjection: {
      mode: 'whole-file', originalBytes: Buffer.byteLength(content, 'utf8'), includedBytes: Buffer.byteLength(content, 'utf8'),
      includedRanges: [{ start: 1, end: lines.length }], adjacentLines: 0, requestedAdjacentLines: adjacentLines,
    },
  }
  const includedRanges = mergeRanges(patch.changedRanges, lines.length, adjacentLines)
  const sourceLineNumbers: number[] = []
  const selected: string[] = []
  for (const range of includedRanges) for (let line = range.start; line <= range.end; line += 1) {
    sourceLineNumbers.push(line)
    selected.push(lines[line - 1] ?? '')
  }
  for (const removed of patch.records.filter((record) => record.kind === 'removed')) {
    sourceLineNumbers.push(removed.line)
    selected.push(`[removed before this line] ${removed.content}`)
  }
  const fullContent = selected.join('\n')
  return {
    fullContent,
    sourceLineNumbers,
    contextProjection: {
      mode: 'changed-hunks', originalBytes: Buffer.byteLength(content, 'utf8'), includedBytes: Buffer.byteLength(fullContent, 'utf8'),
      includedRanges, adjacentLines: actualAdjacentLines(sourceLineNumbers, patch.changedRanges), requestedAdjacentLines: adjacentLines,
    },
  }
}

function projectPatch(patch: string, adjacentLines: number): ProjectedSource | undefined {
  const parsed = parsePatch(patch)
  if (!parsed.records.length || !parsed.changedRanges.length) return undefined
  const maxLine = Math.max(...parsed.records.map((record) => record.line))
  const includedRanges = mergeRanges(parsed.changedRanges, maxLine, adjacentLines)
  const included = parsed.records.filter((record) => record.kind === 'removed' || includedRanges.some((range) => record.line >= range.start && record.line <= range.end))
  const selected = included.map((record) => record.kind === 'removed' ? `[removed before this line] ${record.content}` : record.content)
  const sourceLineNumbers = included.map((record) => record.line)
  const fullContent = selected.join('\n')
  return {
    fullContent,
    sourceLineNumbers,
    contextProjection: {
      mode: 'patch-fallback', originalBytes: Buffer.byteLength(patch, 'utf8'), includedBytes: Buffer.byteLength(fullContent, 'utf8'),
      includedRanges: rangesFromLines(sourceLineNumbers),
      adjacentLines: actualAdjacentLines(sourceLineNumbers, parsed.changedRanges), requestedAdjacentLines: adjacentLines,
    },
  }
}

function unreviewed(file: string, reason: string): ReviewTarget {
  return { file: normalize(file), language: langOf(file), fullContent: '', isChanged: true, reviewStatus: 'UNREVIEWED', unreviewedReason: reason }
}

function applyLimits(targets: ReviewTarget[], limits?: SourceLimits): ReviewTarget[] {
  if (limits?.maxFiles === undefined && limits?.maxBytes === undefined) return targets
  const reviewable = targets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) => target.reviewStatus !== 'UNREVIEWED')
    .sort((a, b) =>
      (b.target.changedRanges?.length ?? 0) - (a.target.changedRanges?.length ?? 0) ||
      b.target.fullContent.length - a.target.fullContent.length ||
      a.index - b.index,
    )
  const maxFiles = limits?.maxFiles ?? Number.POSITIVE_INFINITY
  const maxBytes = limits?.maxBytes ?? Number.POSITIVE_INFINITY
  let bytes = 0
  const selected = new Set<ReviewTarget>()
  const skipped: ReviewTarget[] = []
  for (const { target } of reviewable) {
    const size = Buffer.byteLength(target.fullContent, 'utf8')
    if (selected.size >= maxFiles || bytes + size > maxBytes) {
      skipped.push(unreviewed(target.file, selected.size >= maxFiles ? `PR exceeds ${maxFiles} file limit` : `PR exceeds ${maxBytes} byte limit`))
      continue
    }
    selected.add(target)
    bytes += size
  }
  return [...targets.filter((target) => target.reviewStatus === 'UNREVIEWED'), ...reviewable.filter(({ target }) => selected.has(target)).map(({ target }) => target), ...skipped]
}

function readTarget(file: string, cwd: string, limits: SourceLimits, redact: boolean, changed?: ReviewTarget['changedRanges'], patch?: string): ReviewTarget {
  const normalized = normalize(file)
  const denied = deniedPath(normalized)
  if (denied) return unreviewed(normalized, denied)
  if (!isReviewableName(normalized)) return unreviewed(normalized, 'unsupported text format')
  const abs = join(cwd, normalized)
  let fd: number
  try { fd = openSync(abs, 'r') } catch { return unreviewed(normalized, 'file unavailable') }
  try {
    const size = fstatSync(fd).size
    const maxFileBytes = limits.maxFileBytes ?? DEFAULT_PROMPT_FILE_BYTES
    if (size > (changed?.length ? ABSOLUTE_TOTAL_BYTES : maxFileBytes)) {
      const projected = patch && changed?.length ? projectPatch(patch, limits.contextLines ?? 40) : undefined
      return projected
        ? { file: normalized, language: langOf(normalized), ...projected, changedRanges: changed, patch, isChanged: true }
        : unreviewed(normalized, `file exceeds ${maxFileBytes} byte limit`)
    }
    const fullContent = promptText(readFileSync(fd, 'utf8'))
    if (fullContent === undefined) return unreviewed(normalized, 'binary content')
    const safe = redact ? redactSecrets(fullContent) : fullContent
    const projected = changed?.length && patch ? projectChangedContent(safe, parsePatch(patch), limits.contextLines ?? 40) : {
      fullContent: safe,
      contextProjection: { mode: 'whole-file' as const, originalBytes: size, includedBytes: Buffer.byteLength(safe, 'utf8'), includedRanges: [{ start: 1, end: safe.split('\n').length }], adjacentLines: 0, requestedAdjacentLines: limits.contextLines ?? 40 },
    }
    return { file: normalized, language: langOf(normalized), ...projected, changedRanges: changed, patch, isChanged: Boolean(changed) }
  } catch { return unreviewed(normalized, 'file is not readable text')
  } finally { closeSync(fd) }
}

function withinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function globRegex(pattern: string): RegExp {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; continue }
      out += '.*'; i++; continue
    }
    if (char === '*') { out += '[^/]*'; continue }
    if (char === '?') { out += '[^/]'; continue }
    out += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
  }
  return new RegExp(`${out}$`)
}

function matchesAny(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globRegex(normalize(pattern.replace(/^!/, ''))).test(file))
}

function validatePatterns(patterns: readonly string[]): void {
  if (!patterns.length) throw new Error('isolated-snapshot needs at least one context pattern')
  for (const pattern of patterns) {
    const value = pattern.replace(/^!/, '')
    if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value) || value.split('/').includes('..')) {
      throw new Error(`invalid context pattern "${pattern}": use a repository-relative pattern without .. traversal`)
    }
  }
}

function walkFiles(root: string, current: string, out: string[], unreviewedFiles: ReviewTarget[]): void {
  for (const entry of readdirSync(current)) {
    const abs = join(current, entry)
    const rel = normalize(relative(root, abs))
    if (DENY_DIRS.has(entry)) continue
    let stat
    try { stat = lstatSync(abs) } catch { continue }
    if (stat.isSymbolicLink()) {
      let target: string
      try { target = realpathSync(abs) } catch { unreviewedFiles.push(unreviewed(rel, 'broken symlink')); continue }
      if (!withinRoot(root, target)) unreviewedFiles.push(unreviewed(rel, 'symlink escapes repository root'))
      continue
    }
    if (stat.isDirectory()) walkFiles(root, abs, out, unreviewedFiles)
    else out.push(rel)
  }
}

async function fromGitDiff(c: Extract<SourceConfig, { kind: 'git-diff' }>): Promise<ReviewTarget[]> {
  const cwd = c.cwd ?? process.cwd(); const head = c.head ?? 'HEAD'
  const git = async (args: string[]) => (await run('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout
  const diff = await git(['diff', '--unified=0', `${c.base}...${head}`])
  const targets: ReviewTarget[] = []
  for (const block of diff.split(/^diff --git /m).slice(1)) {
    const pathMatch = block.match(/^a\/(.+?) b\/(.+)$/m); const file = pathMatch?.[2]
    if (!file || block.includes('\ndeleted file mode')) continue
    const target = readTarget(file, cwd, { maxFileBytes: c.limits?.maxFileBytes, contextLines: c.limits?.contextLines }, Boolean(c.redact), changedRanges(block), block)
    targets.push(target)
  }
  return targets
}

export async function loadScmTargets(c: { adapter: ScmAdapter; ref: ChangeRequestRef; diff?: ChangeRequestDiff; baselineRevision?: string; collectErrors?: boolean; redact?: boolean; limits?: SourceLimits }): Promise<ReviewTarget[]> {
  const diff = c.diff ?? await c.adapter.diff(c.ref, c.baselineRevision)
  const sha = diff.headRevision
  const files = diff.files
  const maxFiles = Math.min(c.limits?.maxFiles ?? DEFAULT_GITHUB_PR_FILES, MAX_GITHUB_PR_METADATA_FILES)
  const selectedFiles = new Set(files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.status !== 'removed' && !deniedPath(file.path) && isReviewableName(file.path))
    .sort((a, b) => (changedRanges(b.file.patch ?? '').length - changedRanges(a.file.patch ?? '').length) || a.index - b.index)
    .slice(0, maxFiles)
    .map(({ file }) => file.path))
  const targets: ReviewTarget[] = []
  let downloadedBytes = 0
  let byteBudgetHit = false
  for (const f of files) {
    if (f.status === 'removed') { targets.push(unreviewed(f.path, 'deleted file requires diff-first review')); continue }
    const denied = deniedPath(f.path)
    if (denied || !isReviewableName(f.path)) { targets.push(unreviewed(f.path, denied ?? 'unsupported text format')); continue }
    if (!selectedFiles.has(f.path)) { targets.push(unreviewed(f.path, `PR exceeds ${maxFiles} file limit`)); continue }
    if (byteBudgetHit || downloadedBytes >= (c.limits?.maxBytes ?? Number.POSITIVE_INFINITY)) {
      targets.push(unreviewed(f.path, `PR exceeds ${c.limits?.maxBytes} byte limit`))
      continue
    }
    const fileLimit = c.limits?.maxFileBytes ?? DEFAULT_PROMPT_FILE_BYTES
    const remainingBytes = (c.limits?.maxBytes ?? Number.POSITIVE_INFINITY) - downloadedBytes
    const downloadLimit = Math.min(fileLimit, remainingBytes)
    let content
    try { content = await c.adapter.fileContent(c.ref, f.path, sha, downloadLimit) }
    catch (error) {
      if (!c.collectErrors) throw error
      targets.push(unreviewed(f.path, `file content unavailable: ${error instanceof Error ? error.message : String(error)}`)); continue
    }
    if (content.truncated) {
      const patch = f.patch
      const projected = patch ? projectPatch(patch, c.limits?.contextLines ?? 40) : undefined
      if (!projected) {
        targets.push(unreviewed(f.path, remainingBytes <= fileLimit ? `PR exceeds ${c.limits?.maxBytes} byte limit` : `file exceeds ${fileLimit} byte limit`))
        if (remainingBytes <= fileLimit) byteBudgetHit = true
        continue
      }
      const safe = c.redact ? redactSecrets(projected.fullContent) : projected.fullContent
      const includedBytes = Buffer.byteLength(safe, 'utf8')
      if (downloadedBytes + includedBytes > (c.limits?.maxBytes ?? Number.POSITIVE_INFINITY)) { targets.push(unreviewed(f.path, `PR exceeds ${c.limits?.maxBytes} byte limit`)); byteBudgetHit = true; continue }
      downloadedBytes += includedBytes
      targets.push({ file: f.path, language: langOf(f.path), ...projected, fullContent: safe, contextProjection: { ...projected.contextProjection, includedBytes }, changedRanges: changedRanges(patch!), patch, isChanged: true, commitId: sha })
      continue
    }
    const raw = promptText(content.content)
    if (raw === undefined) { targets.push(unreviewed(f.path, 'binary content')); continue }
    const safe = c.redact ? redactSecrets(raw) : raw
    const projected = f.patch ? projectChangedContent(safe, parsePatch(f.patch), c.limits?.contextLines ?? 40) : { fullContent: safe, contextProjection: { mode: 'whole-file' as const, originalBytes: Buffer.byteLength(raw, 'utf8'), includedBytes: Buffer.byteLength(safe, 'utf8'), includedRanges: [{ start: 1, end: safe.split('\n').length }], adjacentLines: 0, requestedAdjacentLines: c.limits?.contextLines ?? 40 } }
    const size = Buffer.byteLength(projected.fullContent, 'utf8')
    if (downloadedBytes + size > (c.limits?.maxBytes ?? Number.POSITIVE_INFINITY)) {
      targets.push(unreviewed(f.path, `PR exceeds ${c.limits?.maxBytes} byte limit`))
      byteBudgetHit = true
      continue
    }
    downloadedBytes += size
    targets.push({ file: f.path, language: langOf(f.path), ...projected, changedRanges: f.patch ? changedRanges(f.patch) : [], patch: f.patch, isChanged: true, commitId: sha })
  }
  if (!diff.complete) targets.push(unreviewed('[github-pr file list]', `PR file metadata truncated after ${MAX_GITHUB_PR_METADATA_FILES} files`))
  return applyLimits(targets, c.limits)
}

async function fromGithubPr(c: Extract<SourceConfig, { kind: 'github-pr' }>): Promise<ReviewTarget[]> {
  return loadScmTargets({
    adapter: c.adapter ?? createGithubScmAdapter({ token: c.token }),
    ref: { repository: `${c.owner}/${c.repo}`, id: String(c.number) },
    ...(c.baselineSha ? { baselineRevision: c.baselineSha } : {}),
    redact: c.redact,
    limits: c.limits,
  })
}

function fromPaths(c: Extract<SourceConfig, { kind: 'paths' }>): ReviewTarget[] {
  const cwd = c.cwd ?? process.cwd(); const files: string[] = []; const skipped: ReviewTarget[] = []
  for (const p of c.paths) {
    const abs = join(cwd, p); const stat = lstatSync(abs)
    if (stat.isSymbolicLink()) {
      try {
        if (!withinRoot(realpathSync(cwd), realpathSync(abs))) skipped.push(unreviewed(p, 'symlink escapes repository root'))
        else files.push(normalize(p))
      } catch { skipped.push(unreviewed(p, 'broken symlink')) }
      continue
    }
    if (stat.isDirectory()) walkFiles(cwd, abs, files, skipped)
    else files.push(normalize(p))
  }
  return [...skipped, ...files.map((file) => readTarget(file, cwd, { maxFileBytes: c.limits?.maxFileBytes }, Boolean(c.redact)))]
}

function fromSnapshot(c: Extract<SourceConfig, { kind: 'isolated-snapshot' }>): ReviewTarget[] {
  validatePatterns(c.patterns)
  const root = realpathSync(c.cwd); const files: string[] = []; const skipped: ReviewTarget[] = []
  walkFiles(root, root, files, skipped)
  const includes = c.patterns.filter((pattern) => !pattern.startsWith('!')); const excludes = c.patterns.filter((pattern) => pattern.startsWith('!'))
  const selected = files.filter((file) => matchesAny(file, includes) && !matchesAny(file, excludes)).sort()
  const maxFiles = Math.min(c.limits?.maxFiles ?? DEFAULT_SNAPSHOT_FILES, ABSOLUTE_SNAPSHOT_FILES)
  const targets = selected.slice(0, maxFiles).map((file) => readTarget(file, root, { maxFileBytes: c.limits?.maxFileBytes ?? ABSOLUTE_PROMPT_FILE_BYTES }, Boolean(c.redact)))
  for (const file of selected.slice(maxFiles)) skipped.push(unreviewed(file, `snapshot exceeds ${maxFiles} file limit`))
  const maxBytes = Math.min(c.limits?.maxBytes ?? DEFAULT_TOTAL_BYTES, ABSOLUTE_TOTAL_BYTES); let total = 0
  for (const target of targets) {
    total += Buffer.byteLength(target.fullContent, 'utf8')
    if (total > maxBytes && target.reviewStatus !== 'UNREVIEWED') { target.fullContent = ''; target.reviewStatus = 'UNREVIEWED'; target.unreviewedReason = `snapshot exceeds ${maxBytes} byte limit` }
  }
  return [...skipped, ...targets]
}

function fromStdin(c: Extract<SourceConfig, { kind: 'stdin' }>): ReviewTarget[] {
  const file = c.filename ?? 'snippet.txt'; const text = promptText(c.content)
  if (text === undefined) return [unreviewed(file, 'binary content')]
  const content = c.redact ? redactSecrets(text) : text
  const size = Buffer.byteLength(content, 'utf8'); const limit = c.limits?.maxFileBytes ?? DEFAULT_PROMPT_FILE_BYTES
  return [size > limit ? unreviewed(file, `file exceeds ${limit} byte limit`) : { file, language: langOf(file), fullContent: content, isChanged: true }]
}

export async function loadTargets(source: SourceConfig): Promise<ReviewTarget[]> {
  switch (source.kind) {
    case 'git-diff': return fromGitDiff(source)
    case 'scm': return loadScmTargets(source)
    case 'github-pr': return fromGithubPr(source)
    case 'paths': return fromPaths(source)
    case 'stdin': return fromStdin(source)
    case 'isolated-snapshot': return fromSnapshot(source)
  }
}
