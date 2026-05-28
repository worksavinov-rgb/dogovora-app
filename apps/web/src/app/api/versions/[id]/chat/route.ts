import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getAIProvider } from '@/lib/ai/provider'

type Params = { params: Promise<{ id: string }> }

const msgSchema = z.object({
  content: z.string().min(1).max(4000),
  currentDocument: z.string().optional(),
  /**
   * mode:
   *  'edit'  — ИИ редактирует документ, возвращает обновлённый текст + пояснение
   *  'chat'  — обычный вопрос/ответ без изменения документа
   */
  mode: z.enum(['edit', 'chat']).default('edit'),
})

// GET /api/versions/:id/chat — история сообщений
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
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
  const userId = getUserId(req)
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
  const aiProvider = getAIProvider()
  const documentText = data.currentDocument?.trim() || version.content || ''
  const encoder = new TextEncoder()

  // ─── Режим EDIT: ИИ возвращает обновлённый документ ─────────────────────────
  if (data.mode === 'edit') {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

        try {
          // 1. Стримим обновлённый документ
          let updatedDoc = ''
          const docGen = aiProvider.editDocument(documentText, data.content, settings)
          for await (const chunk of docGen) {
            updatedDoc += chunk
            send({ type: 'doc', chunk })
          }

          // 2. Генерируем краткое объяснение только по ТЕКУЩЕЙ правке
          let explanation = ''
          const messages = [{
            role: 'user' as const,
            content: [
              `Инструкция пользователя: ${data.content}`,
              '',
              'Я уже применил эту инструкцию к документу.',
              'Напиши краткое пояснение (2-4 предложения), что именно изменилось по ЭТОЙ инструкции.',
              'Не упоминай старые правки из истории, если они не относятся к текущей инструкции.',
              'Не цитируй полный текст договора.',
            ].join('\n'),
          }]

          const chatGen = aiProvider.chat(messages, settings, updatedDoc)
          for await (const chunk of chatGen) {
            explanation += chunk
            send({ type: 'chat', chunk })
          }

          // 3. Сохраняем объяснение в историю чата
          await prisma.chatMessage.create({
            data: { versionId: id, role: 'AI', content: explanation.trim() },
          })

          send({ type: 'done', updatedDocLength: updatedDoc.length })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          console.error('[chat/edit]', err)
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

  // ─── Режим CHAT: обычный вопрос без изменения документа ─────────────────────
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
        const generator = aiProvider.chat(messages, settings, documentText)
        for await (const chunk of generator) {
          fullResponse += chunk
          send({ type: 'chat', chunk })
        }

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
