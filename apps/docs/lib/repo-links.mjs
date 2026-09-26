import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'

/** Repository files that are not published as site pages link to their GitHub source. */
export const REPO_BLOB_BASE = 'https://github.com/AgentsKit-io/code-review/blob/main/'
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i

/** Case-sensitive existence check, so macOS behaves like the Linux build. */
export function existsExact(path) {
  if (!existsSync(path)) return false
  const parent = dirname(path)
  if (parent === path) return true
  return readdirSync(parent).includes(basename(path)) && existsExact(parent)
}

/** Site route for a public doc path relative to the docs directory (slugs are lower-case). */
export function docRoute(docPath) {
  const slugs = docPath.replace(/\.mdx?$/, '').split('/').filter(segment => segment && segment !== 'index').map(segment => segment.toLowerCase())
  return slugs.length ? `/docs/${slugs.join('/')}` : '/docs'
}

/**
 * Resolve a Markdown link written relative to its source file (so it works on GitHub) into the URL the
 * Fumadocs site should use: a /docs route for published docs, a GitHub blob URL for other repository files.
 */
export function resolveDocLink(url, { docFile, docsDir, repoRoot, publicDocs }) {
  if (!url || EXTERNAL.test(url)) return { kind: 'external', href: url }
  const hashIndex = url.indexOf('#')
  const path = decodeURI(hashIndex === -1 ? url : url.slice(0, hashIndex))
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const target = resolve(dirname(docFile), path)
  const repoPath = relative(repoRoot, target).split(sep).join('/')
  if (!repoPath || repoPath.startsWith('..') || !existsExact(target)) return { kind: 'missing', href: url, target: repoPath || path }
  const docPath = relative(docsDir, target).split(sep).join('/')
  if (!docPath.startsWith('..') && publicDocs.includes(docPath)) return { kind: 'route', href: `${docRoute(docPath)}${hash}`, target: repoPath }
  return { kind: 'repo', href: `${REPO_BLOB_BASE}${repoPath}${hash}`, target: repoPath }
}

/** Remark plugin: rewrite repository-relative links and fail the build on links that resolve nowhere. */
export function remarkRepoLinks(options) {
  return (tree, file) => {
    if (!file.path) return
    const docFile = resolve(file.path)
    const broken = []
    const visit = node => {
      if ((node.type === 'link' || node.type === 'definition') && typeof node.url === 'string') {
        const result = resolveDocLink(node.url, { ...options, docFile })
        if (result.kind === 'missing') broken.push(node.url)
        else node.url = result.href
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
    if (broken.length) throw new Error(`${relative(options.repoRoot, docFile)} has relative links that resolve to no repository file: ${broken.join(', ')}`)
  }
}
