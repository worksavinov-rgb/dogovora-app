import { NextRequest } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { withLoggedAIContext } from '@/lib/ai/provider'
import { anonymizeForAnalysis } from '@/lib/anonymize'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 180

// Текст приходит из тела запроса (не из БД) — без потолка это готовый способ
// раскрутить счёт за ИИ и заблокировать воркер огромным документом.
// 400 000 знаков ≈ 200 страниц — с запасом больше любого реального договора.
const MAX_ANALYZE_TEXT_CHARS = Number(process.env['MAX_ANALYZE_TEXT_CHARS'] ?? 400_000)
const ANALYZE_RATE_PER_10MIN = Number(process.env['ANALYZE_RATE_PER_10MIN'] ?? 10)

// POST /api/documents/analyze — анализ через SSE чтобы браузер не дропал соединение
// Шлём события: {"type":"progress","message":"..."} и финальный {"type":"result",...}
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const rl = await rateLimit(`analyze:${userId}`, ANALYZE_RATE_PER_10MIN, 10 * 60_000)
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: `Слишком много анализов подряд. Подождите ${rl.retryAfterSec} сек.` }),
      { status: 429 },
    )
  }

  const body = await req.json() as { text?: string; role?: string; roleLabel?: string }
  const { text, role, roleLabel: customRoleLabel } = body

  if (!text || typeof text !== 'string') {
    return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 })
  }
  if (text.length > MAX_ANALYZE_TEXT_CHARS) {
    return new Response(
      JSON.stringify({ error: `Документ слишком большой для анализа (${Math.round(text.length / 1000)} тыс. знаков, максимум ${Math.round(MAX_ANALYZE_TEXT_CHARS / 1000)} тыс.). Разбейте файл на части.` }),
      { status: 413 },
    )
  }

  const roleLabel = customRoleLabel ?? (role === 'executor' ? 'Исполнитель' : 'Заказчик')
  const isExecutorSide = role === 'executor'

  const settings = {
    protectionLevel: isExecutorSide ? 60 : 70,
    targetSize: 8000,
    customInstruction: `Роль пользователя: ${roleLabel}. Анализируй договор строго с позиции ${roleLabel} — что выгодно и что невыгодно именно этой стороне.`,
  }

  // SSE stream — держит соединение живым пока идёт анализ
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        send({ type: 'progress', message: 'Читаю договор…' })

        // Убираем персональные данные перед отправкой в ИИ:
        // ФИО, ИНН, ОГРН, адреса, счета, телефоны → нейтральные метки.
        // ИИ анализирует только юридические условия — фильтр безопасности не срабатывает.
        const anonymizedText = anonymizeForAnalysis(text)
        send({ type: 'progress', message: 'Догодок анализирует условия договора…' })

        const result = await withLoggedAIContext('analyze_upload', { userId }, ({ provider }) =>
          provider.review(anonymizedText, settings),
        )

        send({ type: 'result', ...result })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.error({
          event: 'documents.analyze_failed',
          error: e,
          request_id: getRequestId(req),
          user_id: userId,
        })

        // Человекочитаемые сообщения для частых ошибок
        const userMsg = msg.includes('429')
          ? 'GigaChat перегружен — подождите 1–2 минуты и попробуйте снова'
          : msg.includes('auth failed')
          ? 'Ошибка авторизации GigaChat — проверьте GIGACHAT_AUTH_KEY'
          : msg.includes('некорректный JSON') || msg.includes('safety')
          ? 'Догодок не смог обработать документ — попробуйте ещё раз'
          : msg

        send({ type: 'error', message: userMsg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
