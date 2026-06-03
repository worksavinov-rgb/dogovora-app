import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { readFile, saveFile, versionFileKey } from '@/lib/storage'
import { DocumentFormatter } from '@shared/formatting/document-formatter'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/download
// Скачивание DOCX. Доступно только для оплаченных версий.
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: { title: true, number: true },
      },
      purchase: true,
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Проверяем оплату
  if (!version.purchase) {
    return NextResponse.json({ error: 'Версия не оплачена. Для скачивания необходимо купить версию.' }, { status: 403 })
  }

  if (!version.content) {
    return NextResponse.json({ error: 'Документ ещё не сгенерирован' }, { status: 400 })
  }

  let docxBuffer: Buffer | null = null

  // 1. Файл уже лежит в хранилище — читаем по пути
  if (version.formattedFilePath) {
    try {
      docxBuffer = await readFile(version.formattedFilePath)
    } catch (err) {
      console.warn('[download] Файл не найден в хранилище, перегенерирую:', err)
    }
  }

  // 2. Legacy: старые версии хранят base64 в БД
  if (!docxBuffer && version.formattedContent) {
    docxBuffer = Buffer.from(version.formattedContent, 'base64')
  }

  // 3. Нет файла — генерируем на лету и сохраняем в хранилище
  if (!docxBuffer) {
    try {
      docxBuffer = await DocumentFormatter.formatDocument(version.content, {
        contractNumber: version.document.number ?? undefined,
        contractDate: new Date(version.createdAt).toLocaleDateString('ru-RU'),
        city: 'Москва',
      })

      const formattedKey = versionFileKey(id, 'formatted.docx')
      await saveFile(formattedKey, docxBuffer)
      await prisma.version.update({
        where: { id },
        data: {
          formattedFilePath: formattedKey,
          formattingApplied: true,
        },
      })
    } catch (err) {
      console.error('[download] Formatter error:', err)
      return NextResponse.json({ error: 'Ошибка создания файла' }, { status: 500 })
    }
  }

  // Формируем имя файла
  const safeTitle = (version.document.title ?? 'договор')
    .replace(/[^\wА-яЁё\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  const filename = `${safeTitle}_v${version.number}.docx`

  // Копируем буфер в собственный ArrayBuffer (BodyInit принимает ArrayBuffer)
  const arrayBuffer = docxBuffer.buffer.slice(docxBuffer.byteOffset, docxBuffer.byteOffset + docxBuffer.byteLength)

  return new NextResponse(arrayBuffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(docxBuffer.length),
    },
  })
}
