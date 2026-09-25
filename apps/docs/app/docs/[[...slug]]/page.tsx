import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { getMDXComponents } from '@/mdx-components'
import { source } from '@/lib/source'
import { SITE_URL as site } from '@/lib/shell'

type Props = { params: Promise<{ slug?: string[] }> }

export default async function Page({ params }: Props) {
  const { slug } = await params
  const page = source.getPage(slug)
  if (!page) notFound()
  const MDX = page.data.body
  return <DocsPage toc={page.data.toc}><DocsTitle>{page.data.title}</DocsTitle>{page.data.description ? <DocsDescription>{page.data.description}</DocsDescription> : null}<DocsBody><MDX components={getMDXComponents()} /></DocsBody></DocsPage>
}

export function generateStaticParams() { return source.generateParams() }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = source.getPage(slug)
  if (!page) return {}
  const canonical = slug?.length ? `${site}/docs/${slug.join('/')}` : `${site}/docs`
  return { title: page.data.title, description: page.data.description, alternates: { canonical }, openGraph: { type: 'article', title: page.data.title, description: page.data.description, url: canonical } }
}
