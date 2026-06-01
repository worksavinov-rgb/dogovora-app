import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const createSchema = z.object({
  name: z.string().min(1, 'Укажите название шаблона').max(200),
  content: z.string().min(1, 'Шаблон не может быть пустым'),
})

// GET /api/templates — список шаблонов пользователя
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const templates = await prisma.documentTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      // Не возвращаем content в списке — только в деталях
    },
  })

  return NextResponse.json(templates)
}

// POST /api/templates — создать шаблон
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  let data: z.infer<typeof createSchema>
  try {
    data = createSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  // Лимит: не более 50 шаблонов на пользователя
  const count = await prisma.documentTemplate.count({ where: { userId } })
  if (count >= 50) {
    return NextResponse.json({ error: 'Достигнут лимит шаблонов (50)' }, { status: 400 })
  }

  const template = await prisma.documentTemplate.create({
    data: { userId, name: data.name, content: data.content },
  })

  return NextResponse.json(template, { status: 201 })
}
