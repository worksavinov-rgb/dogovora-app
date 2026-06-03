import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { DocumentFormatter } from '@shared/formatting/document-formatter'
import { htmlToPlainText, isHtmlString } from '@/lib/html-to-text'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/apply-formatting
// Применяет форматирование к уже существующему контенту версии.
// Используется для загруженных договоров (base === 'upload').
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: { title: true, number: true },
      },
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!version.content) return NextResponse.json({ error: 'Версия не содержит текста' }, { status: 400 })
  if (version.formattingApplied) return NextResponse.json({ message: 'Форматирование уже применено' }, { status: 200 })

  // Берём город из профиля пользователя
  const profiles = await prisma.profile.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    take: 1,
  })
  const legalAddress = profiles[0]?.legalAddress ?? ''
  const cityFromProfile = legalAddress.match(/(?:г\.|город)\s+([А-Яа-яЁё\-]+)/i)?.[1] ?? null
  const city = cityFromProfile ?? 'Москва'

  try {
    const plainContent = isHtmlString(version.content) ? htmlToPlainText(version.content) : version.content

    const formattedBuffer = await DocumentFormatter.formatDocument(plainContent, {
      contractNumber: version.document.number ?? undefined,
      contractDate: new Date(version.createdAt).toLocaleDateString('ru-RU'),
      city,
    })

    const formattedBase64 = formattedBuffer.toString('base64')

    await prisma.version.update({
      where: { id },
      data: {
        formattedContent: formattedBase64,
        formattingApplied: true,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[apply-formatting] Error:', err)
    return NextResponse.json({ error: 'Ошибка форматирования' }, { status: 500 })
  }
}
