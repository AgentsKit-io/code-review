#!/usr/bin/env node
// Writes Cloudflare `_headers` into the static export so it answers like the Vercel deployment:
// HSTS everywhere, JSON for the prerendered search index and PNG for the Open Graph image
// (extensionless files would otherwise be served as application/octet-stream).
import { writeFileSync } from 'node:fs'

const rules = [
  ['/*', ['Strict-Transport-Security: max-age=63072000']],
  ['/api/search', ['Content-Type: application/json']],
  ['/opengraph-image', ['Content-Type: image/png']],
]
writeFileSync('out/_headers', `${rules.map(([path, headers]) => [path, ...headers.map((h) => `  ${h}`)].join('\n')).join('\n\n')}\n`)
console.log(`wrote out/_headers (${rules.length} rules)`)
