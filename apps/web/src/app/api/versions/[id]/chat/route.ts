import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { mockProvider } from '@/lib/ai/mock-provider'

type Params = { params: Promise<{ id: string }> }

const msgSchema = z.object({
  content: z.string().min(1).max(4000),
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

  // Загружаем историю для контекста
  const history = await prisma.chatMessage.findMany({
    where: { versionId: id },
    orderBy: { createdAt: 'asc' },
  })

  const messages = history.map((m) => ({
    role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }))

  const aiSettings = version.aiSettings as { protectionLevel?: number; targetSize?: number; customInstruction?: string }
  const settings = {
    protectionLevel: aiSettings?.protectionLevel ?? 70,
    targetSize: aiSettings?.targetSize ?? 8000,
    customInstruction: aiSettings?.customInstruction ?? '',
  }

  // SSE-стриминг ответа ИИ
  const encoder = new TextEncoder()
  let fullResponse = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = mockProvider.chat(messages, settings, '')
        for await (const chunk of generator) {
          fullResponse += chunk
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`))
        }

        // Сохраняем полный ответ ИИ в БД
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
