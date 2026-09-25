import { readFileSync, readdirSync, statSync } from 'node:fs'
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
  if (products.find((product) => product.id === 'playbook')?.navigation?.showInBar !== false) errors.push('Playbook must remain directly available but have navigation.showInBar=false')
  if (products.find((product) => product.id === 'code-review')?.navigation?.showInBar !== true) errors.push('Code Review must have navigation.showInBar=true')
} catch (error) { errors.push(`cannot validate ecosystem.json: ${error.message}`) }

const roots = ['README.md', 'CONTRIBUTING.md', 'ecosystem.json', 'llms.txt', 'llms-full.txt', 'public', 'docs', 'app', 'apps']
const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.doc-bridge', '.codex'])
const publicExtensions = new Set(['.md', '.mdx', '.txt', '.json', '.html', '.ts', '.tsx', '.js', '.mjs', '.yaml', '.yml'])
function visit(path) {
  let st
  try { st = statSync(path) } catch { return }
  if (st.isDirectory()) {
    if (skip.has(path.split('/').at(-1))) return
    for (const entry of readdirSync(path)) visit(join(path, entry))
    return
  }
  const name = path.split('/').at(-1)
  const ext = name.slice(name.lastIndexOf('.'))
  if (!publicExtensions.has(ext) || /\.(test|spec)\./.test(name)) return
  const rel = relative(root, path)
  const content = readFileSync(path, 'utf8')
  if (/\bAKOS\b|akos\.agentskit\.io|agentskit-os/i.test(content)) errors.push(`${rel} exposes a retired AKOS reference`)
  if (/AgentsKit-io\/code-review-cli|code-review-cli/i.test(content)) errors.push(`${rel} exposes the retired code-review-cli repository name`)
}
for (const path of roots) {
  const full = join(root, path)
  try { if (statSync(full).isDirectory()) visit(full); else visit(full) } catch {}
}
const result = { status: errors.length ? 'failed' : 'passed', criteria: ['ecosystem-standardization'], repository: root, expectedHeaderOrder: expected, errors }
console.log(JSON.stringify(result))
if (errors.length) process.exitCode = 1
