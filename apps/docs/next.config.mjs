import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()
// CF_STATIC_EXPORT=1 builds the static export served by Cloudflare (wrangler.toml); every page and the
// search index (force-static) are prerendered. Unset, the Vercel build is unchanged.
const staticExport = process.env.CF_STATIC_EXPORT === '1'
export default withMDX({
  reactStrictMode: true,
  ...(staticExport ? { output: 'export' } : {}),
  images: {
    ...(staticExport ? { unoptimized: true } : {}),
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      { protocol: 'https', hostname: 'www.bestpractices.dev', pathname: '/projects/13866/**' },
      { protocol: 'https', hostname: 'github.com', pathname: '/AgentsKit-io/code-review/actions/workflows/**' },
      { protocol: 'https', hostname: 'img.shields.io', pathname: '/badge/**' },
    ],
  },
})
