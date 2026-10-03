#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toPosix } from '@agentskit/cross-platform/pure'
import { API, SymbolFlags } from 'typescript/unstable/sync'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'package.json')
const snapshotPath = path.join(root, 'docs/stability/public-api-v1.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const update = process.argv.includes('--update')
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--update')

if (unknownArgs.length) {
  console.error(`public-api: unknown argument ${unknownArgs[0]}`)
  console.error('Usage: npm run check:public-api [-- --update]')
  process.exit(2)
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const kindOrder = ['type', 'value']

function exportTargets(entry) {
  if (typeof entry === 'string') return [entry]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []

  const conditions = Object.keys(entry)
  const ordered = ['types', 'import', 'require', 'default', ...conditions]
  for (const condition of ordered) {
    if (condition in entry) {
      const targets = exportTargets(entry[condition])
      if (targets.length) return targets
    }
  }
  return []
}

function sourcePath(target) {
  const normalized = toPosix(target)
  if (normalized === './package.json') return null
  if (!normalized.startsWith('./dist/') || !normalized.endsWith('.js')) {
    throw new Error(`unsupported package export target: ${target}`)
  }
  return path.join(root, normalized.slice('./dist/'.length).replace(/\.js$/, '.ts'))
}

function symbolKinds(checker, symbol) {
  let resolved = symbol
  if (symbol.flags & SymbolFlags.Alias) {
    try {
      resolved = checker.getAliasedSymbol(symbol)
    } catch {
      // Keep the original flags if an alias cannot be resolved.
    }
  }
  const flags = resolved.flags
  const kinds = []
  if (flags & SymbolFlags.Type) kinds.push('type')
  if (flags & SymbolFlags.Value) kinds.push('value')
  if (flags & (SymbolFlags.NamespaceModule | SymbolFlags.ValueModule) && !kinds.includes('value')) {
    kinds.push('value')
  }
  if (!kinds.length) kinds.push('value')
  return kinds.sort((a, b) => kindOrder.indexOf(a) - kindOrder.indexOf(b))
}

const exportEntries = manifest.exports ?? { '.': manifest.types ?? manifest.main }
const entries = Object.keys(exportEntries).some((key) => key === '.' || key.startsWith('./'))
  ? exportEntries
  : { '.': exportEntries }
const subpathSources = new Map()
const assets = new Map()

for (const [subpath, entry] of Object.entries(entries).sort(([a], [b]) => compare(a, b))) {
  const targets = exportTargets(entry)
  if (!targets.length) throw new Error(`${subpath}: no supported export target found`)
  const source = sourcePath(targets[0])
  if (source === null) {
    assets.set(subpath, targets.map((target) => target.replace(/^\.\//, '')).sort(compare))
  } else {
    if (!existsSync(source)) throw new Error(`${subpath}: source entry not found: ${source}`)
    subpathSources.set(subpath, source)
  }
}

const api = new API({ cwd: root })
const snapshotHandle = api.updateSnapshot({ openProjects: [path.join(root, 'tsconfig.build.json')] })
const project = snapshotHandle.getProject(path.join(root, 'tsconfig.build.json'))
if (!project) throw new Error('unable to load TypeScript project')
const program = project.program
const checker = project.checker
const subpaths = {}

for (const [subpath, source] of subpathSources) {
  const sourceFile = program.getSourceFile(source)
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile)
  if (!sourceFile || !moduleSymbol) throw new Error(`${subpath}: unable to inspect exports from ${source}`)
  const symbols = checker.getExportsOfModule(moduleSymbol).map((symbol) => ({
    name: symbol.name,
    kinds: symbolKinds(checker, symbol),
  })).sort((a, b) => compare(a.name, b.name))
  subpaths[subpath] = { symbols }
}
snapshotHandle.dispose()
api.close()
for (const [subpath, exportedAssets] of assets) {
  subpaths[subpath] = { assets: exportedAssets, symbols: [] }
}

const snapshot = {
  schemaVersion: 1,
  package: manifest.name,
  subpaths: Object.fromEntries(Object.entries(subpaths).sort(([a], [b]) => compare(a, b))),
}
const serialized = `${JSON.stringify(snapshot, null, 2)}\n`

function showDiff(previous, current) {
  const oldSnapshot = JSON.parse(previous)
  const oldSubpaths = oldSnapshot.subpaths ?? {}
  const newSubpaths = current.subpaths
  const changes = []
  for (const subpath of [...new Set([...Object.keys(oldSubpaths), ...Object.keys(newSubpaths)])].sort(compare)) {
    const before = oldSubpaths[subpath]
    const after = newSubpaths[subpath]
    if (!before) {
      changes.push(`  + subpath ${subpath}`)
      for (const symbol of after.symbols ?? []) changes.push(`    + ${symbol.name} [${symbol.kinds.join('|')}]`)
      continue
    }
    if (!after) {
      changes.push(`  - subpath ${subpath}`)
      continue
    }
    const oldSymbols = new Map((before.symbols ?? []).map((symbol) => [symbol.name, symbol.kinds]))
    const newSymbols = new Map((after.symbols ?? []).map((symbol) => [symbol.name, symbol.kinds]))
    for (const name of [...new Set([...oldSymbols.keys(), ...newSymbols.keys()])].sort(compare)) {
      if (!oldSymbols.has(name)) changes.push(`  + ${subpath} ${name} [${newSymbols.get(name).join('|')}]`)
      else if (!newSymbols.has(name)) changes.push(`  - ${subpath} ${name} [${oldSymbols.get(name).join('|')}]`)
      else if (oldSymbols.get(name).join('|') !== newSymbols.get(name).join('|')) {
        changes.push(`  ~ ${subpath} ${name}: [${oldSymbols.get(name).join('|')}] -> [${newSymbols.get(name).join('|')}]`)
      }
    }
  }
  if (!changes.length) changes.push('  snapshot formatting or metadata changed')
  console.error(changes.join('\n'))
}

if (update) {
  mkdirSync(path.dirname(snapshotPath), { recursive: true })
  writeFileSync(snapshotPath, serialized)
  console.log(`public-api: updated ${path.relative(root, snapshotPath)}`)
} else {
  if (!existsSync(snapshotPath)) {
    console.error(`public-api: snapshot missing at ${path.relative(root, snapshotPath)}`)
    console.error('Run npm run check:public-api:update to create it.')
    process.exit(1)
  }
  const previous = readFileSync(snapshotPath, 'utf8')
  if (previous !== serialized) {
    console.error('public-api: exported API drifted from docs/stability/public-api-v1.json:')
    try {
      showDiff(previous, snapshot)
    } catch {
      console.error('  baseline is invalid JSON or has an unsupported schema')
    }
    console.error('If this change is intentional, run npm run check:public-api:update and review the diff.')
    process.exit(1)
  }
  console.log(`public-api: ok — ${manifest.name}, ${Object.keys(subpaths).length} export subpaths`)
}
