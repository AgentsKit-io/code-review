import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import publicDocs from './public-docs.json'

export const docs = defineDocs({
  dir: '../../docs',
  docs: { files: publicDocs },
  meta: { files: ['meta.json'] },
})

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
    },
  },
})
