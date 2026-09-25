import { HomeLayout } from 'fumadocs-ui/layouts/home'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { ReviewConfigDemo } from '@/components/review-config-demo'
import { ConfigurationSection, DeliverySection, ProviderSection } from '@/components/home-sections'
import { SiteFooter } from '@/components/site-footer'
import { baseOptions } from '@/lib/layout.shared'
import { PRODUCT_GITHUB as CODE_REVIEW_GITHUB, PRODUCT_ID } from '@/lib/shell'

const layoutOptions: BaseLayoutProps = {
  ...baseOptions(),
  links: [
    { text: 'Overview', url: '/' },
    { text: 'Docs', url: '/docs' },
    { text: 'Getting started', url: '/docs/getting-started' },
  ],
}

function EcosystemTour() {
  return <agentskit-ecosystem current={PRODUCT_ID} data-visual="agentskit-home">
    <section className="ecosystem-fallback" aria-labelledby="ecosystem-title">
      <div className="ak-container journey-grid">
        <div><p className="ak-eyebrow">The AgentsKit ecosystem</p><h2 id="ecosystem-title" className="ak-display">Build the agent. Then take it all the way.</h2></div>
        <p className="journey-copy">One connected toolkit to discover working agents, compose their foundation, deliver the experience, transfer knowledge, verify changes, and operate in production.</p>
      </div>
    </section>
  </agentskit-ecosystem>
}

export default function HomePage() {
  return <HomeLayout {...layoutOptions}>
    <main id="main-content" className="code-review-home">
      <agentskit-aurora aria-hidden="true" />
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
