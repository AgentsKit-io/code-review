import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()
export default withMDX({
  reactStrictMode: true,
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      { protocol: 'https', hostname: 'www.bestpractices.dev', pathname: '/projects/13866/**' },
      { protocol: 'https', hostname: 'github.com', pathname: '/AgentsKit-io/code-review/actions/workflows/**' },
      { protocol: 'https', hostname: 'img.shields.io', pathname: '/badge/**' },
    ],
  },
})
