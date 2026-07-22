import { NextRequest } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { withLoggedAIContext } from '@/lib/ai/provider'
import { anonymizeForAnalysis } from '@/lib/anonymize'

export const maxDuration = 180

// POST /api/documents/analyze — анализ через SSE чтобы браузер не дропал соединение
// Шлём события: {"type":"progress","message":"..."} и финальный {"type":"result",...}
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const body = await req.json() as { text?: string; role?: string; roleLabel?: string }
  const { text, role, roleLabel: customRoleLabel } = body

  if (!text || typeof text !== 'string') {
    return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 })
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
        console.error('[analyze] failed:', msg)

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
