import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const createSchema = z.object({
  type: z.enum(['CONTRACT', 'APPENDIX', 'AMENDMENT']),
  title: z.string().min(1, 'Укажите название'),
  number: z.string().optional(),
  counterpartyId: z.string().min(1, 'Выберите контрагента'),
  // AI-настройки для первой версии
  aiSettings: z.object({
    protectionLevel: z.number().min(0).max(100).default(65),
    targetSize: z.number().default(8400),
    customInstruction: z.string().default(''),
    base: z.enum(['scratch', 'template', 'upload']).default('scratch'),
    description: z.string().default(''),
  }).optional(),
})

// GET /api/documents?q=&type=&status=&counterpartyId=
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const type = searchParams.get('type') // CONTRACT | APPENDIX | AMENDMENT
  const status = searchParams.get('status') // DRAFT | IN_PROGRESS | REVIEW | APPROVED | PAID
  const counterpartyId = searchParams.get('counterpartyId')
  const limit = searchParams.get('limit') ? Math.min(Number(searchParams.get('limit')), 100) : undefined

  const documents = await prisma.document.findMany({
    where: {
      userId,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(type ? { type: type as 'CONTRACT' | 'APPENDIX' | 'AMENDMENT' } : {}),
      ...(counterpartyId ? { counterpartyId } : {}),
    },
    include: {
      counterparty: true,
      versions: {
        orderBy: { number: 'desc' },
        take: 1,
        include: { purchase: true },
      },
      _count: { select: { versions: true } },
    },
    orderBy: { updatedAt: 'desc' },
    ...(limit ? { take: limit } : {}),
  })

  // Фильтр по статусу последней версии
  const filtered = status
    ? documents.filter((d) => d.versions[0]?.status === status)
    : documents

  // Поддерживаем оба формата: массив (старый) и { items } (новый)
  if (searchParams.get('limit')) {
    return NextResponse.json({ items: filtered })
  }
  return NextResponse.json(filtered)
}

// POST /api/documents
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

  // Проверяем что контрагент принадлежит пользователю
  const cp = await prisma.counterparty.findFirst({ where: { id: data.counterpartyId, userId } })
  if (!cp) return NextResponse.json({ error: 'Контрагент не найден' }, { status: 404 })

  const aiSettings = data.aiSettings ?? {
    protectionLevel: 65,
    targetSize: 8400,
    customInstruction: '',
    base: 'scratch',
    description: '',
  }

  // Создаём документ + первую версию (DRAFT) атомарно
  const document = await prisma.document.create({
    data: {
      userId,
      counterpartyId: data.counterpartyId,
      title: data.title,
      number: data.number,
      type: data.type,
      versions: {
        create: {
          number: 1,
          status: 'DRAFT',
          aiSettings,
        },
      },
    },
    include: {
      counterparty: true,
      versions: { orderBy: { number: 'desc' }, include: { purchase: true } },
      _count: { select: { versions: true } },
    },
  })

  return NextResponse.json(document, { status: 201 })
}
