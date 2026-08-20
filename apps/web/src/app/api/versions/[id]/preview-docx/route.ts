import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { hasInlineRequisites } from '@/lib/html-document'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

// Точный предпросмотр: текущий HTML тела → .docx (тот же конвертер, что при
// скачивании) → фронт рисует его docx-preview. Принцип брифа: предпросмотр = то,
// что скачается.
//
// Почему не assemblePresentation: она структурирует и КЭШИРУЕТ результат по
// versionId. Для живого, ещё не сохранённого тела (после ИИ-/ручной правки) кэш
// вернул бы устаревший вид. Поэтому берём переданное тело как есть (оно уже
// структурировано при загрузке версии) и оборачиваем слоем оформления так же,
// как хвост assemblePresentation.
//
// Неизменённые загруженные документы рисуются из ОРИГИНАЛА (см. .../original),
// сюда попадает только изменённый/созданный контент.

const MAX_HTML_BYTES = 4 * 1024 * 1024

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: {
      content: true,
      document: {
        select: { id: true, title: true, preambleHtml: true, requisitesHtml: true },
      },
    },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { content?: string; bare?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  // Тело версии для рендера: переданное с фронта (живые правки) либо сохранённое.
  const content = (typeof body.content === 'string' && body.content.trim())
    ? body.content
    : version.content
  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Документ пуст' }, { status: 400 })
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_HTML_BYTES) {
    return NextResponse.json({ error: 'Документ слишком большой' }, { status: 413 })
  }

  try {
    // Сборка «листа» = тот же порядок слоёв, что в assemblePresentation.full и
    // в скачивании: шапка (оформление) + тело + реквизиты (оформление). Для
    // legacy/загруженных документов шапка и реквизиты уже вклеены в тело —
    // оборачивать не нужно.
    const bare = body.bare === true
    const doc = version.document
    const full = (bare || hasInlineRequisites(content))
      ? content
      : [doc.preambleHtml, content, doc.requisitesHtml]
          .filter((s): s is string => Boolean(s && s.trim()))
          .join('\n')

    const docx = await convertToDocx(full, { title: doc.title })
    return new NextResponse(new Uint8Array(docx), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Length': String(docx.byteLength),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    logger.error({
      event: 'version.preview_docx_error',
      error: err,
      request_id: getRequestId(req),
      user_id: userId,
      version_id: id,
    })
    return NextResponse.json({ error: 'Не удалось собрать предпросмотр' }, { status: 500 })
  }
}
