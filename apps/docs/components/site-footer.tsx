import { ECOSYSTEM_PRODUCTS, PRODUCT_GITHUB, PRODUCT_ID, PRODUCT_REPO } from '@/lib/shell'

const localColumns = [
  { title: 'Start', links: [{ text: 'Documentation', href: '/docs' }, { text: 'Getting started', href: '/docs/getting-started' }, { text: 'Operations', href: '/docs/operations' }] },
  { title: 'Review', links: [{ text: 'Provider compatibility', href: '/docs/provider-compatibility' }, { text: 'Quality matrix', href: '/docs/quality-matrix' }, { text: 'Continuous improvement', href: '/docs/continuous-improvement' }] },
]

/**
 * Shared ecosystem footer. Server HTML carries a static fallback (six products, repo, license)
 * for SEO and no-JS; shell v1.js upgrades the element and keeps the product-owned `local` columns.
 */
export function SiteFooter() {
  return <agentskit-footer current={PRODUCT_ID} repo={PRODUCT_REPO}>
    <div slot="local" className="ak-footer-local">
      {localColumns.map(column => <nav className="ak-footer-col" key={column.title} aria-label={column.title}>
        <p className="ak-footer-col__title">{column.title}</p>
        <ul>{column.links.map(link => <li key={link.href}><a href={link.href}>{link.text}</a></li>)}</ul>
      </nav>)}
    </div>
    <nav className="ak-footer-fallback" aria-label="AgentsKit ecosystem">
      {ECOSYSTEM_PRODUCTS.map(product => <a key={product.id} href={product.href} aria-current={product.id === PRODUCT_ID ? 'page' : undefined}>{product.name}</a>)}
      <a href={PRODUCT_GITHUB}>GitHub</a>
      <a href={`${PRODUCT_GITHUB}/blob/main/LICENSE`}>MIT License</a>
    </nav>
  </agentskit-footer>
}
