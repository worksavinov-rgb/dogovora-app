import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono, Source_Serif_4 } from 'next/font/google'
import './globals.css'

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-ui',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

const sourceSerif4 = Source_Serif_4({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Договора — SaaS для работы с договорами через ИИ',
  description: 'Создавайте, проверяйте и храните договоры с помощью искусственного интеллекта',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} ${sourceSerif4.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
