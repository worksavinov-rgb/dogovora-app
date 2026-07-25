import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { saveFile, versionFileKey } from '@/lib/storage'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/apply-formatting
// Применяет форматирование к уже существующему контенту версии.
// Используется для загруженных договоров (base === 'upload').
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
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

  try {
    // HTML-aware конвертер: сохраняет таблицы, объединённые ячейки, жирность,
    // нумерацию и блок реквизитов. Тот же, что использует download route.
    const formattedBuffer = await convertToDocx(version.content, {
      title: version.document.title ?? undefined,
    })

    const formattedKey = versionFileKey(id, 'formatted.docx')
    await saveFile(formattedKey, formattedBuffer)

    await prisma.version.update({
      where: { id },
      data: {
        formattingApplied: true,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error({
      event: 'versions.apply_formatting_failed',
      error: err,
      request_id: getRequestId(req),
      user_id: userId,
      version_id: id,
    })
    return NextResponse.json({ error: 'Ошибка форматирования' }, { status: 500 })
  }
}
