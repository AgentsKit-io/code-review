import { docs } from '@/.source/server'
import { loader } from 'fumadocs-core/source'

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  // Routes are lower-case regardless of file name (docs/OPERATIONS.md → /docs/operations).
  slugs: (_file, fallback) => fallback().map(slug => slug.toLowerCase()),
})
