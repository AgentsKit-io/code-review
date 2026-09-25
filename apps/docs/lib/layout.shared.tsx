import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

/** Product nav wordmark; styling comes from the shared shell v1.css. */
export function ProductWordmark() {
  return <span className="ak-product-wordmark"><span className="ak-product-wordmark__brand">AgentsKit</span> <span className="ak-product-wordmark__product">Code Review</span></span>
}

/** Shared Fumadocs options. The GitHub Star action lives only in the ecosystem bar. */
export function baseOptions(): BaseLayoutProps {
  return { nav: { title: <ProductWordmark /> } }
}
