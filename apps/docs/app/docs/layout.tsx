import type { ReactNode } from 'react'
import { source } from '@/lib/source'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { baseOptions } from '@/lib/layout.shared'
import { SiteFooter } from '@/components/site-footer'

// The footer sits after the Fumadocs grid, not inside it, so the sticky sidebar and TOC never cover it.
export default function Layout({ children }: { children: ReactNode }) {
  return <>
    <DocsLayout tree={source.pageTree} {...baseOptions()}>{children}</DocsLayout>
    <SiteFooter />
  </>
}
