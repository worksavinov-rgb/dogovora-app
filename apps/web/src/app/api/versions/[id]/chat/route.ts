import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { withLoggedAIContext } from '@/lib/ai/provider'
import { htmlToPlainText, isHtmlString } from '@/lib/html-to-text'
import { anonymizeForAnalysis } from '@/lib/anonymize'
import { splitRequisitesBlock } from '@/lib/html-document'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// Защита от злоупотребления бесплатными ИИ-запросами (правки/вопросы стоят нам денег,
// а внутри версии они бесплатны для пользователя — платит только за покупку версии).
// - лимит бесплатных ИИ-запросов на ОДНУ неоплаченную версию (после покупки правки
//   создают новую версию с собственным лимитом);
// - rate-limit по частоте (защита от скриптового флуда чата).
const FREE_AI_REQUESTS_PER_VERSION = Number(process.env.FREE_AI_EDITS_PER_VERSION ?? 20)
const CHAT_RATE_PER_MIN = Number(process.env.CHAT_RATE_PER_MIN ?? 15)

const msgSchema = z.object({
  content: z.string().min(1).max(4000),
  currentDocument: z.string().optional(),
  /**
   * mode:
   *  'edit'  — ИИ редактирует документ, возвращает обновлённый текст + пояснение
   *  'chat'  — обычный вопрос/ответ без изменения документа
   */
  mode: z.enum(['edit', 'chat', 'quick_analysis']).default('edit'),
})

// GET /api/versions/:id/chat — история сообщений
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: { chatMessages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(version.chatMessages)
}

// POST /api/versions/:id/chat — отправить сообщение + получить SSE-стриминг ответа
//
// SSE-события:
//   data: {"type":"doc","chunk":"..."}   — кусок обновлённого документа
//   data: {"type":"chat","chunk":"..."}  — кусок объяснения для чат-пузыря
//   data: [DONE]                         — конец потока
//
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: { document: { include: { counterparty: true } }, purchase: { select: { id: true } } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof msgSchema>
  try {
    data = msgSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  // ─── Защита от злоупотребления ──────────────────────────────────────────────
  // 1) Частотный лимит (защита от скриптового флуда): N запросов/мин на пользователя.
  const rl = await rateLimit(`chat:${userId}`, CHAT_RATE_PER_MIN, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Слишком много запросов подряд. Подождите ${rl.retryAfterSec} сек. и попробуйте снова.`, code: 'RATE_LIMITED' },
      { status: 429 },
    )
  }
  // 2) Лимит бесплатных ИИ-запросов на неоплаченную версию.
  //    Купленная версия лимита не имеет; правки после покупки создают новую версию
  //    (у неё будет собственный лимит), поэтому «купите версию» — валидный выход.
  if (!version.purchase) {
    const usedRequests = await prisma.chatMessage.count({
      where: { versionId: id, role: 'USER' },
    })
    if (usedRequests >= FREE_AI_REQUESTS_PER_VERSION) {
      return NextResponse.json(
        {
          error: `Вы использовали ${FREE_AI_REQUESTS_PER_VERSION} бесплатных ИИ-правок для этой версии. Купите версию, чтобы продолжить редактирование — после покупки правки снова доступны.`,
          code: 'FREE_LIMIT_REACHED',
        },
        { status: 402 },
      )
    }
  }

  // Сохраняем сообщение пользователя
  await prisma.chatMessage.create({
    data: { versionId: id, role: 'USER', content: data.content },
  })

  const aiSettings = version.aiSettings as { protectionLevel?: number; targetSize?: number; customInstruction?: string }
  const settings = {
    protectionLevel: aiSettings?.protectionLevel ?? 70,
    targetSize: aiSettings?.targetSize ?? 8000,
    customInstruction: aiSettings?.customInstruction ?? '',
  }
  const rawDoc = data.currentDocument?.trim() || version.content || ''
  // Для edit-режима передаём HTML как есть — editDocument умеет работать с HTML.
  // Для chat-режима: plain text + маскирование ПДн (документ не перезаписывается).
  const documentText = rawDoc
  // Чат: без подвала реквизитов + маскирование остаточного ПДн.
  const bodyForChat = splitRequisitesBlock(rawDoc).body
  const documentTextForChat = anonymizeForAnalysis(
    isHtmlString(bodyForChat) ? htmlToPlainText(bodyForChat) : bodyForChat,
  )
  const encoder = new TextEncoder()

  // ─── Режим EDIT: ИИ возвращает обновлённый документ ─────────────────────────
  if (data.mode === 'edit') {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

        try {
          let updatedDoc = ''
          let failed = false
          console.log('[chat/edit] starting editDocument, docLength=', documentText.length, 'instruction=', data.content.slice(0, 80))
          await withLoggedAIContext('edit', { userId, versionId: id }, async ({ provider }) => {
            const docGen = provider.editDocument(documentText, data.content, settings)
            for await (const chunk of docGen) {
              if (chunk === '__EDIT_FAILED__') {
                failed = true
              } else {
                updatedDoc += chunk
                send({ type: 'doc', chunk })
              }
            }
          })
          console.log('[chat/edit] editDocument done, updatedDocLength=', updatedDoc.length, 'failed=', failed)

          if (failed || !updatedDoc.trim()) {
            const msg = 'Не удалось применить изменение — не нашёл точный фрагмент в документе. Попробуйте уточнить запрос: укажите номер пункта или процитируйте часть текста который нужно изменить.'
            send({ type: 'chat', chunk: msg })
            await prisma.chatMessage.create({
              data: { versionId: id, role: 'AI', content: msg },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }

          // Простое подтверждение без лишнего AI-запроса
          const explanation = 'Готово — изменения внесены в документ.'
          send({ type: 'chat', chunk: explanation })

          await prisma.chatMessage.create({
            data: { versionId: id, role: 'AI', content: explanation.trim() || 'Документ обновлён.' },
          })

          send({ type: 'done', updatedDocLength: updatedDoc.length })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          logger.error({
            event: 'versions.chat_edit_failed',
            error: err,
            request_id: getRequestId(req),
            user_id: userId,
            version_id: id,
          })
          // Отправляем ошибку клиенту как читаемое сообщение
          try {
            const errMsg = err instanceof Error ? err.message : 'Ошибка Догодка'
            send({ type: 'chat', chunk: `Ошибка: ${errMsg.slice(0, 200)}` })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {
            controller.error(err)
          }
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

  // ─── Режим CHAT / QUICK_ANALYSIS: вопрос без изменения документа ────────────
  const chatTask = data.mode === 'quick_analysis' ? 'quick_analysis' as const : 'chat' as const
  const history = await prisma.chatMessage.findMany({
    where: { versionId: id },
    orderBy: { createdAt: 'asc' },
  })
  const messages = history.map((m) => ({
    role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }))

  let fullResponse = ''
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      try {
        await withLoggedAIContext(chatTask, { userId, versionId: id }, async ({ provider }) => {
          const generator = provider.chat(messages, settings, documentTextForChat)
          for await (const chunk of generator) {
            fullResponse += chunk
            send({ type: 'chat', chunk })
          }
        })

        await prisma.chatMessage.create({
          data: { versionId: id, role: 'AI', content: fullResponse.trim() },
        })

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        controller.error(err)
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
