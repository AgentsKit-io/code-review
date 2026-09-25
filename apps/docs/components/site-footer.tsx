import { ECOSYSTEM_PRODUCTS, PRODUCT_GITHUB, PRODUCT_ID, PRODUCT_REPO } from '@/lib/shell'

/** Shared ecosystem footer. The static fallback keeps links in server HTML; shell v1.js upgrades it. */
export function SiteFooter() {
  return <agentskit-footer current={PRODUCT_ID} repo={PRODUCT_REPO}>
    <footer className="cr-footer-fallback">
      <nav aria-label="AgentsKit ecosystem">
        <ul>{ECOSYSTEM_PRODUCTS.map(product => <li key={product.id}><a href={product.href} aria-current={product.id === PRODUCT_ID ? 'page' : undefined}>{product.name}</a></li>)}</ul>
      </nav>
      <p><a href={PRODUCT_GITHUB}>GitHub · {PRODUCT_REPO}</a> · <a href={`${PRODUCT_GITHUB}/blob/main/LICENSE`}>MIT License</a></p>
    </footer>
  </agentskit-footer>
}
