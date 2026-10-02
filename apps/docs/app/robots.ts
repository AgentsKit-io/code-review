import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/shell'
// Prerendered: no request-time data (also required by the Cloudflare static export).
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL } }
