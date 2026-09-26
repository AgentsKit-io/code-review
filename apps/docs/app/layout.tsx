import type { Metadata, Viewport } from 'next'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { PRODUCT_ID, PRODUCT_REPO, SHELL_CSS, SHELL_JS, SITE_URL } from '@/lib/shell'

const site = SITE_URL
const inter = Inter({ subsets: ['latin'], variable: '--font-body' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' })
const description = 'Configurable, provider-neutral code review with focused findings, clear evidence, and review policies you control.'

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: 'AgentsKit Code Review', template: '%s · AgentsKit Code Review' },
  description,
  applicationName: 'AgentsKit Code Review',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'AgentsKit Code Review', title: 'AgentsKit Code Review', description, url: site, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: 'AgentsKit Code Review', description, images: ['/opengraph-image'] },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#0d1117' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable} ${spaceGrotesk.variable}`}>
    <head>
      <link rel="stylesheet" href={SHELL_CSS} />
      <script src={SHELL_JS} data-current={PRODUCT_ID} data-current-repo={PRODUCT_REPO} defer />
    </head>
    <body><RootProvider>{children}</RootProvider></body>
  </html>
}
