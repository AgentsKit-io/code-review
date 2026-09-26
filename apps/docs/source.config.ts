import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { resolve } from 'node:path'
import publicDocs from './public-docs.json'
import { remarkRepoLinks } from './lib/repo-links.mjs'

// fumadocs-mdx and next build both run from apps/docs.
const docsDir = resolve(process.cwd(), '../../docs')
const repoRoot = resolve(process.cwd(), '../..')

export const docs = defineDocs({
  dir: '../../docs',
  docs: { files: publicDocs },
  meta: { files: ['meta.json'] },
})

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [[remarkRepoLinks, { docsDir, repoRoot, publicDocs }]],
    rehypeCodeOptions: {
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
    },
  },
})
