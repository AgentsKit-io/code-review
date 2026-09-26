import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { SITE_URL } from '@/lib/shell'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL
  return [
    { url: base, changeFrequency: 'monthly', priority: 1 },
    ...source.getPages().map(page => ({ url: page.slugs.length ? `${base}/docs/${page.slugs.join('/')}` : `${base}/docs`, changeFrequency: 'monthly' as const, priority: 0.7 })),
  ]
}
