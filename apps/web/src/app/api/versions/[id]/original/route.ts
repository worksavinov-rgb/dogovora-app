import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { readFile, saveFile, versionFileKey } from '@/lib/storage'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

// Оригинальный .docx загруженного документа.
//
// Зачем: точный предпросмотр (docx-preview) рисует именно тот .docx, что скачается.
// Для ЗАГРУЖЕННЫХ документов таким источником служит сам исходный файл пользователя —
// раньше он выбрасывался (в БД сохранялся только HTML от mammoth). Теперь бинарь
// кладём в STORAGE_DIR рядом с версией, а ключ — в свободное поле Version.filePath.
//
// POST — сохранить оригинал (вызывается со страницы загрузки сразу после создания
//        документа; сырые байты .docx в теле запроса).
// GET  — отдать оригинал для рендера docx-preview.
//
// Версии append-only не нарушаем: файл привязан к версии 1 как её исходник и
// больше не меняется. Правки создают новые версии, у которых своего оригинала нет —
// они собираются нашим convertToDocx (см. бриф docx-preview-integration).

const MAX_DOCX_BYTES = 8 * 1024 * 1024
const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ORIGINAL_FILENAME = 'original.docx'

type Params = { params: Promise<{ id: string }> }

// .docx — это zip-архив, начинается с сигнатуры "PK" (0x50 0x4B).
function looksLikeDocx(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
}

// POST /api/versions/:id/original — сохранить исходный .docx версии
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: { id: true },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const arrayBuffer = await req.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'Пустой файл' }, { status: 400 })
  }
  if (buffer.byteLength > MAX_DOCX_BYTES) {
    return NextResponse.json({ error: 'Файл слишком большой' }, { status: 413 })
  }
  if (!looksLikeDocx(buffer)) {
    return NextResponse.json({ error: 'Ожидался файл .docx' }, { status: 415 })
  }

  try {
    const key = versionFileKey(id, ORIGINAL_FILENAME)
    await saveFile(key, buffer)
    await prisma.version.update({ where: { id }, data: { filePath: key } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error({
      event: 'version.original_save_error',
      error: err,
      request_id: getRequestId(req),
      user_id: userId,
      version_id: id,
      bytes: buffer.byteLength,
    })
    return NextResponse.json({ error: 'Не удалось сохранить файл' }, { status: 500 })
  }
}

// GET /api/versions/:id/original — отдать исходный .docx для предпросмотра
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: { filePath: true },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Старые загрузки оригинала не имеют — точный вид задним числом недоступен,
  // фронт деградирует на обычный рендер. Это ожидаемо (см. бриф).
  if (!version.filePath) {
    return NextResponse.json({ error: 'Оригинал недоступен' }, { status: 404 })
  }

  try {
    const buffer = await readFile(version.filePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': DOCX_CONTENT_TYPE,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    // Ключ в БД есть, а файла на диске нет (потерян/не мигрирован) — та же деградация.
    return NextResponse.json({ error: 'Оригинал недоступен' }, { status: 404 })
  }
}
