import { createElement } from 'react'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { ReviewConfigDemo } from '@/components/review-config-demo'
import { LiquidCursorGradient } from '@/components/liquid-cursor-gradient'
import { ConfigurationSection, DeliverySection, ProviderSection } from '@/components/home-sections'

const CODE_REVIEW_GITHUB = 'https://github.com/AgentsKit-io/code-review'

const layoutOptions: BaseLayoutProps = {
  nav: {
    title: <span className="app-wordmark"><svg aria-hidden="true" viewBox="0 0 48 48"><path d="M8 35 24 8l16 27H8Z" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="24" cy="8" r="4" fill="currentColor"/><circle cx="8" cy="35" r="4" fill="currentColor"/><circle cx="40" cy="35" r="4" fill="currentColor"/></svg><span>AgentsKit <span className="app-wordmark-product">Code Review</span></span></span>,
  },
  links: [
    { text: 'Overview', url: '/' },
    { text: 'Docs', url: '/docs' },
    { text: 'Getting started', url: '/docs/getting-started' },
  ],
  githubUrl: CODE_REVIEW_GITHUB,
}

const products = [
  { name: 'AgentsKit', href: 'https://www.agentskit.io' },
  { name: 'Registry', href: 'https://registry.agentskit.io' },
  { name: 'Chat', href: 'https://chat.agentskit.io' },
  { name: 'Doc Bridge', href: 'https://doc-bridge.agentskit.io' },
  { name: 'Code Review', href: 'https://code-review.agentskit.io' },
  { name: 'Harness', href: 'https://harness.agentskit.io' },
]

function EcosystemTour() {
  return createElement('agentskit-ecosystem', { current: 'code-review', 'data-visual': 'agentskit-home' },
    <section className="ecosystem-fallback" aria-labelledby="ecosystem-title">
      <div className="ak-container journey-grid">
        <div><p className="ak-eyebrow">The AgentsKit ecosystem</p><h2 id="ecosystem-title" className="ak-display">Build the agent. Then take it all the way.</h2></div>
        <p className="journey-copy">One connected toolkit to discover working agents, compose their foundation, deliver the experience, align teams, transfer knowledge, and operate in production.</p>
      </div>
    </section>,
  )
}

function BrandMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48"><path d="M8 35 24 8l16 27H8Z" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="24" cy="8" r="4" fill="currentColor"/><circle cx="8" cy="35" r="4" fill="currentColor"/><circle cx="40" cy="35" r="4" fill="currentColor"/></svg>
}

function SiteFooter() {
  const columns = [
    { title: 'Start', links: [{ text: 'Documentation', href: '/docs' }, { text: 'Getting started', href: '/docs/getting-started' }, { text: 'Operations', href: '/docs/operations' }] },
    { title: 'Review', links: [{ text: 'Provider compatibility', href: '/docs/provider-compatibility' }, { text: 'Quality matrix', href: '/docs/quality-matrix' }, { text: 'Continuous improvement', href: '/docs/continuous-improvement' }] },
    { title: 'Ecosystem', links: products.map(product => ({ text: product.name, href: product.href, current: product.name === 'Code Review' })) },
    { title: 'Community', links: [{ text: 'GitHub', href: CODE_REVIEW_GITHUB }, { text: 'Contribute', href: `${CODE_REVIEW_GITHUB}/blob/main/CONTRIBUTING.md` }, { text: 'For agents · llms.txt', href: '/llms.txt' }] },
  ]

  return <footer className="ak-footer">
    <div className="ak-container">
      <div className="footer-grid">
        <div className="footer-brand"><div className="footer-wordmark"><BrandMark /><strong>AgentsKit</strong></div><p>Provider-neutral code review that follows your standards, with findings you can trace to changed code.</p><div className="footer-badges"><a href={CODE_REVIEW_GITHUB}>GitHub</a><span>Open source</span></div></div>
        {columns.map(column => <div className="footer-column" key={column.title}><h2>{column.title}</h2><ul>{column.links.map(link => <li key={link.text}><a href={link.href} aria-current={'current' in link && link.current ? 'page' : undefined}>{link.text}</a></li>)}</ul></div>)}
      </div>
      <div className="footer-bottom"><span>© AgentsKit Code Review · MIT</span><a href={CODE_REVIEW_GITHUB}>Built in the open <span aria-hidden="true">↗</span></a></div>
    </div>
  </footer>
}

export default function HomePage() {
  return <HomeLayout {...layoutOptions}>
    <main id="main-content" className="code-review-home">
      <LiquidCursorGradient />
      <div className="home-content">
        <section className="hero" aria-labelledby="home-title">
          <div className="ak-container hero-grid">
            <div className="hero-copy-column"><p className="ak-eyebrow">Open source · provider neutral · configured by you</p><h1 id="home-title" className="ak-display">Code review that follows <span>your standards.</span></h1><p className="hero-copy">Choose the policies your team cares about. Code Review turns them into focused, evidence-backed comments with the provider you already use.</p><div className="hero-actions"><a className="ak-cta ak-cta-primary" href={`${CODE_REVIEW_GITHUB}#installation`}>Install and use <span aria-hidden="true">↗</span></a><a className="ak-cta" href="/docs">Explore the docs</a></div></div>
            <ReviewConfigDemo />
          </div>
        </section>
        <ConfigurationSection />
        <ProviderSection />
        <DeliverySection />
        <EcosystemTour />
        <SiteFooter />
      </div>
    </main>
  </HomeLayout>
}
