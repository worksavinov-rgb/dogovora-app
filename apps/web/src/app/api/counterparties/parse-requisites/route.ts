import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { detectKind, extractPlainText, FileReadError } from '@/lib/file-text'
import { parseRequisites } from '@/lib/requisites-parser'

// Разбор идёт на сервере, а не в браузере: здесь уже лежат валидаторы контрольных
// сумм, логика покрыта тестами в одном месте, и файл не приходится тащить в
// состояние React. Наружу — в том числе в ИИ — не уходит ничего.
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const PARSE_RATE_PER_10MIN = Number(process.env['REQUISITES_PARSE_RATE_PER_10MIN'] ?? 20)

// POST /api/counterparties/parse-requisites — распознать реквизиты из файла
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`requisites:${userId}`, PARSE_RATE_PER_10MIN, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Слишком много загрузок подряд. Подождите ${rl.retryAfterSec} сек.` },
      { status: 429 },
    )
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Файл не получен' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Файл больше 10 МБ' }, { status: 413 })
  }

  let kind
  try {
    kind = detectKind(file.name)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof FileReadError ? e.message : 'Неподдерживаемый формат' },
      { status: 400 },
    )
  }
  if (!kind) {
    return NextResponse.json({ error: 'Поддерживаются файлы .docx, .pdf и .txt' }, { status: 400 })
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const text = await extractPlainText(buf, kind)
    // Правило 11: в логи не уходит ни строки из файла — только поля наружу вызывающему.
    return NextResponse.json({ fields: parseRequisites(text), fileName: file.name })
  } catch (e) {
    if (e instanceof FileReadError) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    return NextResponse.json({ error: 'Не удалось обработать файл' }, { status: 500 })
  }
}
