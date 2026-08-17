import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { runWithAI } from '@/lib/ai/provider'
import { rateLimit } from '@/lib/rate-limit'

// Провайдер анализирует первые ~6 000 знаков (реквизиты в начале документа),
// но тело запроса без потолка позволяло присылать мегабайты. Ограничиваем вход.
const MAX_EXTRACT_TEXT_CHARS = 200_000
const EXTRACT_RATE_PER_10MIN = Number(process.env['EXTRACT_RATE_PER_10MIN'] ?? 15)

// POST /api/documents/extract-parties — извлечение реквизитов сторон из текста договора
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`extract:${userId}`, EXTRACT_RATE_PER_10MIN, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Слишком много запросов подряд. Подождите ${rl.retryAfterSec} сек.` },
      { status: 429 },
    )
  }

  const body = await req.json() as { text?: string; consentPii?: boolean }
  const { text, consentPii } = body

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if (text.length > MAX_EXTRACT_TEXT_CHARS) {
    return NextResponse.json({ error: 'Документ слишком большой' }, { status: 413 })
  }

  // Операционное согласие на отправку ИМЕННО ЭТОГО файла в ИИ без маскирования
  // (галочка в UI загрузки). Задача extract_parties по назначению работает
  // с неанонимизированным текстом — реквизиты и есть то, что извлекаем.
  if (!consentPii) {
    return NextResponse.json(
      { error: 'Для автозаполнения реквизитов необходимо согласие на отправку данных в ИИ' },
      { status: 400 },
    )
  }

  try {
    const result = await runWithAI('extract_parties', { userId }, (aiProvider) =>
      aiProvider.extractParties(text),
    )
    return NextResponse.json(result)
  } catch {
    // Мусорный JSON от модели раньше ронял маршрут в голый 500.
    return NextResponse.json(
      { error: 'Не удалось распознать стороны. Заполните реквизиты вручную.' },
      { status: 502 },
    )
  }
}
