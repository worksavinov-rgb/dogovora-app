import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const createSchema = z.object({
  type: z.enum(['CONTRACT', 'APPENDIX', 'AMENDMENT']),
  title: z.string().min(1, 'Укажите название'),
  number: z.string().optional(),
  signingDate: z.string().optional(),
  profileId: z.string().optional(),
  counterpartyId: z.string().min(1, 'Выберите контрагента'),
  userRole: z.enum(['CUSTOMER', 'EXECUTOR', 'customer', 'executor']).optional(),
  // Иерархия: для APPENDIX/AMENDMENT — опциональная привязка к родительскому CONTRACT
  parentDocumentId: z.string().optional(),
  documentNumber: z.number().int().positive().optional(),
  // Текст загруженного файла (если base === 'upload')
  uploadedContent: z.string().optional(),
  // Подписанты сторон, выбранные на шаге настройки документа
  profileSignatoryId: z.string().optional(),
  counterpartySignatoryId: z.string().optional(),
  // Замороженные HTML-блоки шапки (преамбулы) и реквизитов/подписей — собраны и,
  // возможно, отредактированы пользователем на шаге настройки. Сохраняются как есть
  // и больше не пересчитываются из текущих данных Profile/Counterparty.
  preambleHtml: z.string().optional(),
  requisitesHtml: z.string().optional(),
  // AI-настройки для первой версии.
  // ВАЖНО: мастер создания документа (documents/new/page.tsx) кладёт сюда же userRole,
  // profileId и referenceContent — эти поля ОБЯЗАТЕЛЬНО должны быть объявлены здесь,
  // иначе zod.parse() молча отбрасывает их при валидации (по умолчанию схема "strip"),
  // и при генерации документ получит роль/профиль по дефолту вместо выбранных
  // пользователем (баг, который уже случился с userRole и profileId).
  aiSettings: z.object({
    protectionLevel: z.number().min(0).max(100).default(65),
    targetSize: z.number().default(8400),
    customInstruction: z.string().default(''),
    base: z.enum(['scratch', 'template', 'upload']).default('scratch'),
    description: z.string().default(''),
    userRole: z.enum(['CUSTOMER', 'EXECUTOR', 'customer', 'executor']).optional(),
    profileId: z.string().optional(),
    referenceContent: z.string().optional(),
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
      profile: { select: { id: true, name: true, type: true } },
      versions: {
        orderBy: { number: 'desc' },
        take: 1,
        include: { purchase: true },
      },
      parentDocument: { select: { id: true, title: true, number: true } },
      _count: { select: { versions: true, childDocuments: true } },
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

  // Если передан загруженный текст — используем его как начальный контент версии
  const uploadedContent = body.uploadedContent as string | undefined
  const hasUploadedContent = Boolean(uploadedContent && uploadedContent.trim().length > 0)
  const fileSize = hasUploadedContent ? Buffer.byteLength(uploadedContent!.trim(), 'utf8') : undefined

  // Если передан parentDocumentId — проверяем что он принадлежит пользователю
  if (data.parentDocumentId) {
    const parentDoc = await prisma.document.findFirst({
      where: { id: data.parentDocumentId, userId, type: 'CONTRACT' },
    })
    if (!parentDoc) return NextResponse.json({ error: 'Родительский договор не найден' }, { status: 404 })
  }

  // Автонумерация: MAX(documentNumber) + 1, чтобы после удалений не было дублей
  let documentNumber = data.documentNumber
  if (data.parentDocumentId && !documentNumber) {
    const maxDoc = await prisma.document.findFirst({
      where: { parentDocumentId: data.parentDocumentId, type: data.type },
      orderBy: { documentNumber: 'desc' },
      select: { documentNumber: true },
    })
    documentNumber = (maxDoc?.documentNumber ?? 0) + 1
  }

  // Создаём документ + первую версию (DRAFT) атомарно
  let document
  try { document = await prisma.document.create({
    data: {
      userId,
      counterpartyId: data.counterpartyId,
      title: data.title,
      number: data.number,
      signingDate: data.signingDate ? new Date(data.signingDate) : undefined,
      profileId: data.profileId || undefined,
      type: data.type,
      parentDocumentId: data.parentDocumentId,
      documentNumber,
      versions: {
        create: {
          number: 1,
          status: 'DRAFT',
          aiSettings,
          ...(hasUploadedContent ? {
            content: uploadedContent!.trim(),
            fileSize,
          } : {}),
        },
      },
    },
    include: {
      counterparty: true,
      versions: { orderBy: { number: 'desc' }, include: { purchase: true } },
      _count: { select: { versions: true } },
    },
  })

  } catch (err) {
    console.error('[POST /api/documents] DB error:', err)
    return NextResponse.json({ error: 'Ошибка создания документа' }, { status: 500 })
  }

  // BigInt (fileSize) не сериализуется в JSON — конвертируем в number
  const safe = JSON.parse(JSON.stringify(document, (_k, v) =>
    typeof v === 'bigint' ? Number(v) : v
  ))
  return NextResponse.json(safe, { status: 201 })
}
