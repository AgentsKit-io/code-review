import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://code-review.agentskit.io'
  return [
    { url: base, changeFrequency: 'monthly', priority: 1 },
    ...source.getPages().map(page => ({ url: `${base}/docs/${page.slugs.join('/')}`, changeFrequency: 'monthly' as const, priority: 0.7 })),
  ]
}
