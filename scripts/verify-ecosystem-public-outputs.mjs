import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const expected = ['agentskit', 'registry', 'agentskit-chat', 'doc-bridge', 'code-review', 'harness']
const errors = []
const manifestPath = join(root, 'ecosystem.json')
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const products = manifest.products ?? manifest
  const visible = products.filter((product) => product.navigation?.showInBar).map((product) => product.id)
  if (JSON.stringify(visible) !== JSON.stringify(expected)) errors.push(`ecosystem.json header order must be ${expected.join(' → ')}; got ${visible.join(' → ')}`)
  if (products.some((product) => product.id === 'akos' || /akos/i.test(`${product.name} ${product.url ?? ''} ${product.surfaces?.home ?? ''}`))) errors.push('ecosystem.json contains public AKOS metadata')
  const ids = products.map((product) => product.id)
  if (JSON.stringify(ids.filter((id) => expected.includes(id))) !== JSON.stringify(expected)) errors.push(`ecosystem.json must list the six canonical products in order ${expected.join(' → ')}; got ${ids.join(' → ')}`)
  // Only a hidden Playbook record (kept for Doc Bridge cross-link validation) may exist outside the canonical six.
  const extra = products.filter((product) => !expected.includes(product.id))
  if (extra.some((product) => product.id !== 'playbook')) errors.push(`ecosystem.json lists non-canonical products: ${extra.map((product) => product.id).join(', ')}`)
  if (extra.some((product) => product.navigation?.showInBar !== false || product.navigation?.order !== undefined || product.navigation?.next?.length || product.showcase)) errors.push('Playbook may only remain as a hidden compatibility record (showInBar=false, no order, no next, no showcase)')
  const shim = (manifest.properties ?? []).filter((property) => !expected.includes(property.id))
  if (shim.length) errors.push(`ecosystem.json properties shim lists non-canonical products: ${shim.map((property) => property.id).join(', ')}`)
  if (products.some((product) => product.navigation?.next?.includes('playbook'))) errors.push('no ecosystem product may route to Playbook')
  if (manifest.positioning?.openSourceProductIds && JSON.stringify(manifest.positioning.openSourceProductIds) !== JSON.stringify(expected)) errors.push('positioning.openSourceProductIds must match the six canonical products')
  if (products.find((product) => product.id === 'code-review')?.navigation?.showInBar !== true) errors.push('Code Review must have navigation.showInBar=true')
} catch (error) { errors.push(`cannot validate ecosystem.json: ${error.message}`) }

const roots = ['README.md', 'CONTRIBUTING.md', 'ecosystem.json', 'llms.txt', 'llms-full.txt', 'public', 'docs', 'app', 'apps']
const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.doc-bridge', '.codex'])
const publicExtensions = new Set(['.md', '.mdx', '.txt', '.json', '.html', '.ts', '.tsx', '.js', '.mjs', '.yaml', '.yml'])
function visit(path, isDirectory = false) {
  if (isDirectory) {
    if (skip.has(path.split('/').at(-1))) return
    let entries
    try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(path, entry.name), true)
      else if (entry.isFile()) visit(join(path, entry.name))
    }
    return
  }
  const name = path.split('/').at(-1)
  const ext = name.slice(name.lastIndexOf('.'))
  if (!publicExtensions.has(ext) || /\.(test|spec)\./.test(name)) return
  const rel = relative(root, path)
  let content
  try { content = readFileSync(path, 'utf8') } catch { return }
  if (/\bAKOS\b|akos\.agentskit\.io|agentskit-os/i.test(content)) errors.push(`${rel} exposes a retired AKOS reference`)
  if (/AgentsKit-io\/code-review-cli|code-review-cli/i.test(content)) errors.push(`${rel} exposes the retired code-review-cli repository name`)
}
const directories = new Set(['public', 'docs', 'app', 'apps'])
for (const path of roots) visit(join(root, path), directories.has(path))
const result = { status: errors.length ? 'failed' : 'passed', criteria: ['ecosystem-standardization'], repository: root, expectedHeaderOrder: expected, errors }
console.log(JSON.stringify(result))
if (errors.length) process.exitCode = 1
