import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { SYSTEM_RULES } from '../agents/code-review/rules.js'

export interface RuleEntry {
  path: string
  rule: string
  /** false = use only this rule, skipping the matching system checklist. Default true (merge). */
  mergeSystemRule?: boolean
}

export interface RuleLayers {
  project?: RuleEntry[]
  global?: RuleEntry[]
}

export interface ResolvedRule {
  rule: string
  source: 'project' | 'global' | 'system' | 'none'
  /** True when a project/global rule was combined with a matching system checklist. */
  mergedSystem: boolean
}

const RuleEntrySchema = z.object({
  path: z.string().min(1),
  rule: z.string().min(1),
  mergeSystemRule: z.boolean().optional(),
}).strict()
const RulesFileSchema = z.object({ rules: z.array(RuleEntrySchema) }).strict()

const globRegexCache = new Map<string, RegExp>()

/**
 * Minimal glob matcher: `**` (any depth, including `/`), `*` (any run within one path
 * segment), `?` (one character), `{a,b,c}` (alternation). No external dependency — this
 * repository already prefers small hand-written matchers over a glob library (see
 * `pathMatches` in `src/review-stores.ts`); a full micromatch/picomatch equivalent is
 * more surface area than a short glob list needs.
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  let regex = globRegexCache.get(pattern)
  if (!regex) {
    let source = '^'
    let index = 0
    while (index < pattern.length) {
      const char = pattern[index]
      if (char === '*' && pattern[index + 1] === '*') {
        source += '.*'
        index += 2
        if (pattern[index] === '/') index++
      } else if (char === '*') {
        source += '[^/]*'
        index++
      } else if (char === '?') {
        source += '[^/]'
        index++
      } else if (char === '{') {
        const end = pattern.indexOf('}', index)
        if (end < 0) { source += '\\{'; index++; continue }
        const options = pattern.slice(index + 1, end).split(',').map((option) => option.replace(/[.+^$()|[\]\\]/g, '\\$&'))
        source += `(?:${options.join('|')})`
        index = end + 1
      } else if ('.+^$()|[]\\'.includes(char!)) {
        source += `\\${char}`
        index++
      } else {
        source += char
        index++
      }
    }
    source += '$'
    regex = new RegExp(source)
    globRegexCache.set(pattern, regex)
  }
  return regex.test(filePath)
}

function loadRulesFile(path: string): RuleEntry[] {
  try {
    const parsed = RulesFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data.rules : []
  } catch {
    return []
  }
}

/** Reads the project (`<root>/.agentskit-review/rules.json`) and global (`~/.agentskit-review/rules.json`) rule layers, if present. Missing or malformed files are silently treated as empty — a rules layer is optional, never a hard requirement. */
export function loadRuleLayers(options: { projectRoot?: string; projectRulesPath?: string; globalRulesPath?: string } = {}): RuleLayers {
  const projectPath = options.projectRulesPath ?? join(options.projectRoot ?? process.cwd(), '.agentskit-review', 'rules.json')
  const globalPath = options.globalRulesPath ?? join(homedir(), '.agentskit-review', 'rules.json')
  return {
    project: existsSync(projectPath) ? loadRulesFile(projectPath) : undefined,
    global: existsSync(globalPath) ? loadRulesFile(globalPath) : undefined,
  }
}

function firstMatch(entries: RuleEntry[] | undefined, filePath: string): RuleEntry | undefined {
  return entries?.find((entry) => matchGlob(entry.path, filePath))
}

/**
 * Resolves the review rule for one file: project layer beats global layer beats the
 * built-in system checklist. A project/global entry is merged with its matching system
 * checklist unless `mergeSystemRule: false`. `ocr rules check <path>`-equivalent: call
 * this directly to see which rule, and from which layer, applies to a given file.
 */
export function resolveRuleForFile(filePath: string, layers: RuleLayers = {}): ResolvedRule {
  const project = firstMatch(layers.project, filePath)
  const global = project ? undefined : firstMatch(layers.global, filePath)
  const userEntry = project ?? global
  const userSource: 'project' | 'global' | undefined = project ? 'project' : global ? 'global' : undefined
  const systemEntry = SYSTEM_RULES.find((entry) => matchGlob(entry.glob, filePath))
  if (userEntry && userSource) {
    if (userEntry.mergeSystemRule === false || !systemEntry) return { rule: userEntry.rule, source: userSource, mergedSystem: false }
    return { rule: `${userEntry.rule}\n\n${systemEntry.rule}`, source: userSource, mergedSystem: true }
  }
  return systemEntry ? { rule: systemEntry.rule, source: 'system', mergedSystem: false } : { rule: '', source: 'none', mergedSystem: false }
}

/**
 * Resolves and deduplicates rules for every file in a group (a context pack), so files
 * sharing a language contribute one copy of the checklist, not one per file.
 */
export function resolveRulesForFiles(filePaths: readonly string[], layers: RuleLayers = {}): string[] {
  const seen = new Set<string>()
  const rules: string[] = []
  for (const filePath of filePaths) {
    const resolved = resolveRuleForFile(filePath, layers)
    if (resolved.rule && !seen.has(resolved.rule)) {
      seen.add(resolved.rule)
      rules.push(resolved.rule)
    }
  }
  return rules
}
