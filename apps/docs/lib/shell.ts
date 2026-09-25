/** AgentsKit ecosystem shell v1 integration (bar, tour, footer, aurora, shared tokens). */
export const SHELL_ORIGIN = (process.env.NEXT_PUBLIC_AGENTSKIT_SHELL_ORIGIN || 'https://www.agentskit.io').replace(/\/+$/, '')
export const SHELL_CSS = `${SHELL_ORIGIN}/shell/v1.css`
export const SHELL_JS = `${SHELL_ORIGIN}/shell/v1.js`
export const PRODUCT_ID = 'code-review'
export const PRODUCT_REPO = 'AgentsKit-io/code-review'
export const PRODUCT_GITHUB = `https://github.com/${PRODUCT_REPO}`
export const SITE_URL = 'https://code-review.agentskit.io'

export const ECOSYSTEM_PRODUCTS = [
  { id: 'agentskit', name: 'AgentsKit', href: 'https://www.agentskit.io' },
  { id: 'registry', name: 'Registry', href: 'https://registry.agentskit.io' },
  { id: 'agentskit-chat', name: 'Chat', href: 'https://chat.agentskit.io' },
  { id: 'doc-bridge', name: 'Doc Bridge', href: 'https://doc-bridge.agentskit.io' },
  { id: 'code-review', name: 'Code Review', href: SITE_URL },
  { id: 'harness', name: 'Harness', href: 'https://harness.agentskit.io' },
] as const
