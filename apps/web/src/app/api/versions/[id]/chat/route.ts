import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { withLoggedAIContext } from '@/lib/ai/provider'
import { chargeTokens, getEditQuota, InsufficientTokensError, insufficientTokensResponse } from '@/lib/token-charges'
import { TOKEN_PRICES, EDITS_PER_PACKAGE } from '@/lib/token-pricing'
import { htmlToPlainText, isHtmlString } from '@/lib/html-to-text'
import { anonymizeForAnalysis } from '@/lib/anonymize'
import { splitRequisitesBlock, splitDocumentPreamble } from '@/lib/html-document'
import { diffDocumentBlocks, buildEditReportPrompt, summarizeChanges } from '@/lib/edit-report'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// Защита от злоупотребления: rate-limit по частоте (защита от скриптового флуда).
// Платность правок регулируется пакетами (см. token-charges.getEditQuota):
// правки тратят пакет документа, вопросы и анализ бесплатны.
const CHAT_RATE_PER_MIN = Number(process.env.CHAT_RATE_PER_MIN ?? 15)

/**
 * Изменился ли документ по существу.
 * Сравниваем видимый текст без разметки и пробелов: модель может вернуть тот же
 * документ с иначе расставленными переносами или атрибутами — это не правка, и
 * действие из пакета за такое списывать нельзя.
 */
function documentChanged(before: string, after: string): boolean {
  const normalize = (s: string) =>
    s.replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  return normalize(before) !== normalize(after)
}

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
    include: { document: { include: { counterparty: true } } },
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
  // ─── Пакет действий Догодка ─────────────────────────────────────────────────
  // Пакет тратят ВСЕ обращения к ИИ: и правка, и вопрос, и быстрый анализ.
  // Раньше платной была только правка, а вопросы работали даром и без лимита —
  // по загруженному документу можно было бесплатно получить полный разбор
  // договора, ни разу ничего не оплатив. Оплата — предоплатная: первое обращение
  // к ИИ по документу открывает пакет, дальше действия расходуют его.
  // Ручное редактирование остаётся бесплатным всегда — оно ИИ не задействует.
  const documentId = version.documentId
  let quota = { limit: 0, used: 0 } // снапшот для расчёта остатка в done-событии
  {
    let q = await getEditQuota(documentId)
    // Загруженный документ: первое обращение к ИИ платное — открывает пакет
    if (q.isUploaded && q.packages === 0) {
      try {
        await chargeTokens({
          userId,
          kind: 'UPLOAD_EDIT_START',
          tokens: TOKEN_PRICES.uploadEditStart,
          documentId,
          versionId: id,
          idempotentPerDocument: true,
          description: `Работа Догодка с загруженным документом: ${version.document.title}`,
        })
      } catch (err) {
        if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
        throw err
      }
      q = await getEditQuota(documentId)
    }
    quota = { limit: q.limit, used: q.used }
    // Атомарное резервирование действия: инкремент под условием aiEditsUsed < limit.
    // Одна UPDATE-строка сериализует параллельные запросы — сверхлимитное
    // действие не проскочит (проверка-в-начале + инкремент-в-конце допускали гонку).
    // Неудачное действие (__EDIT_FAILED__ / ошибка ИИ) откатываем декрементом.
    const reserved = await prisma.document.updateMany({
      where: { id: documentId, aiEditsUsed: { lt: q.limit } },
      data: { aiEditsUsed: { increment: 1 } },
    })
    if (reserved.count === 0) {
      return NextResponse.json(
        {
          error: `Пакет из ${EDITS_PER_PACKAGE} действий Догодка исчерпан. Купите новый пакет, чтобы продолжить.`,
          code: 'EDIT_PACKAGE_NEEDED',
          price: TOKEN_PRICES.editPackage,
          limit: q.limit,
          used: q.used,
        },
        { status: 402 },
      )
    }
  }

  // Откат зарезервированного действия (ИИ не отработал — пакет не тратим)
  const releaseEdit = async () => {
    await prisma.document.updateMany({
      where: { id: documentId, aiEditsUsed: { gt: 0 } },
      data: { aiEditsUsed: { decrement: 1 } },
    }).catch(() => {})
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
  // Для edit-режима передаём HTML как есть — editDocument умеет работать с HTML,
  // но БЕЗ шапки: она собрана детерминированно из данных ЛК, и модель, получив её
  // вместе с телом, переписывала стороны и основания (жалоба владельца). Роль
  // пользователя ИИ берёт не из шапки, а из settings.customInstruction, поэтому
  // защита интересов от этого не страдает. Шапку возвращаем на место после ответа —
  // ровно так же, как editDocument поступает с подвалом реквизитов.
  // Для chat-режима: plain text + маскирование ПДн (документ не перезаписывается).
  const { preamble: docPreamble, body: documentText } = splitDocumentPreamble(rawDoc)
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
          let updatedDoc = '' // только тело от ИИ, без шапки
          let failed = false
          let preambleSent = false
          // В логи — только размеры. Текст договора и инструкции пользователя
          // не логируются никогда: логи доступны админам и разработчикам.
          console.log('[chat/edit] starting editDocument, docLength=', documentText.length, 'instructionLength=', data.content.length)
          await withLoggedAIContext('edit', { userId, versionId: id }, async ({ provider }) => {
            const docGen = provider.editDocument(documentText, data.content, settings)
            for await (const chunk of docGen) {
              if (chunk === '__EDIT_FAILED__') {
                failed = true
              } else {
                // Клиент собирает документ из чанков по порядку, поэтому шапку
                // отдаём первым куском потока — иначе документ на экране
                // остался бы без неё.
                if (docPreamble && !preambleSent) {
                  preambleSent = true
                  send({ type: 'doc', chunk: `${docPreamble}\n` })
                }
                updatedDoc += chunk
                send({ type: 'doc', chunk })
              }
            }
          })
          console.log('[chat/edit] editDocument done, updatedDocLength=', updatedDoc.length, 'failed=', failed)

          if (failed || !updatedDoc.trim()) {
            await releaseEdit() // правка не применена — возвращаем её в пакет
            const msg = 'Не удалось применить изменение — не нашёл точный фрагмент в документе. Попробуйте уточнить запрос: укажите номер пункта или процитируйте часть текста который нужно изменить.'
            send({ type: 'chat', chunk: msg })
            await prisma.chatMessage.create({
              data: { versionId: id, role: 'AI', content: msg },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }

          // Документ мог вернуться неизменным: модель «согласилась» с заданием,
          // но ничего не поправила (типично для просьб вида «проверь на ошибки» —
          // это по смыслу анализ, а не правка). Раньше пользователь в любом случае
          // получал «Готово — изменения внесены» и терял действие из пакета,
          // хотя документ оставался прежним. Сравниваем и отвечаем честно.
          if (!documentChanged(documentText, updatedDoc)) {
            await releaseEdit() // ничего не изменилось — действие не тратим
            const msg = [
              'Документ не изменился — я не нашёл, что именно нужно поправить по этому запросу.',
              '',
              'Если нужно проверить договор и получить разбор — переключитесь в режим «Вопрос» или нажмите «Анализ».',
              'Если нужна правка — укажите, что именно поменять: номер пункта и новое условие.',
            ].join('\n')
            send({ type: 'chat', chunk: msg })
            await prisma.chatMessage.create({
              data: { versionId: id, role: 'AI', content: msg },
            })
            send({ type: 'done', updatedDocLength: 0, editsRemaining: Math.max(0, quota.limit - quota.used), editsLimit: quota.limit })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }

          // Отчёт о правке. Раньше здесь была одна и та же строка «Готово —
          // изменения внесены в документ»: пользователь не знал ни что сделано,
          // ни что из просьбы осталось невыполненным, и вычитывал договор глазами.
          // Список изменений считает КОД (сравнение блоков до/после), модель лишь
          // формулирует смысл — придумать несуществующую правку она не может.
          const changes = diffDocumentBlocks(documentText, updatedDoc)
          let explanation = ''
          try {
            await withLoggedAIContext('chat', { userId, versionId: id }, async ({ provider }) => {
              const prompt = buildEditReportPrompt(data.content, changes)
              for await (const chunk of provider.chat(
                [{ role: 'user', content: prompt }],
                { ...settings, customInstruction: '' },
                '', // документ повторно не передаём: в задании уже есть нужные фрагменты
              )) {
                explanation += chunk
                send({ type: 'chat', chunk })
              }
            })
          } catch (err) {
            // Отчёт — вспомогательный шаг: правка уже применена, и падение
            // объяснения не должно выглядеть как неудачная правка.
            logger.error({
              event: 'versions.chat_edit_report_failed',
              error: err,
              request_id: getRequestId(req),
              user_id: userId,
              version_id: id,
            })
          }

          if (!explanation.trim()) {
            // Запасной вариант — фактическая сводка по подсчитанным изменениям
            const summary = summarizeChanges(changes)
            explanation = summary
              ? `Готово — правки внесены (${summary}).`
              : 'Готово — изменения внесены в документ.'
            send({ type: 'chat', chunk: explanation })
          }

          await prisma.chatMessage.create({
            data: { versionId: id, role: 'AI', content: explanation.trim() || 'Документ обновлён.' },
          })

          // Правка уже зарезервирована в пакете (updateMany выше). Остаток
          // считаем из снапшота квоты, не перечитывая БД: limit не изменился,
          // used вырос на 1.
          const usedAfter = quota.used + 1
          const fullDoc = docPreamble ? `${docPreamble}\n${updatedDoc}` : updatedDoc
          send({ type: 'done', updatedDocLength: fullDoc.length, editsRemaining: Math.max(0, quota.limit - usedAfter), editsLimit: quota.limit })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          await releaseEdit() // правка сорвалась на ошибке ИИ — возвращаем в пакет
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
