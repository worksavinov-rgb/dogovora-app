import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { LEGAL_DOCUMENTS, getLegalDocument } from '@/lib/legal'
import { LegalDocumentView } from '@/components/legal/legal-document-view'

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((d) => ({ slug: d.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const doc = getLegalDocument(slug)
  if (!doc) return { title: 'Документ не найден — Догодок' }
  return { title: `${doc.title} — Догодок`, description: doc.subtitle }
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const doc = getLegalDocument(slug)
  if (!doc) notFound()

  return <LegalDocumentView doc={doc} />
}
