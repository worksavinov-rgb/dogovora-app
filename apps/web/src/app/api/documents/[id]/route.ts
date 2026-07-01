import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

async function checkIsDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
  const children = await prisma.document.findMany({ where: { parentDocumentId: ancestorId }, select: { id: true } })
  for (const child of children) {
    if (child.id === candidateId) return true
    if (await checkIsDescendant(candidateId, child.id)) return true
  }
  return false
}

// Собирает id всех потомков документа (приложения/допсоглашения и их потомки).
// Нужно потому, что связь parentDocument стоит onDelete: SetNull — без явного
// сбора потомки бы «отвязались», а не удалились вместе с родителем.
async function collectDescendantIds(rootId: string): Promise<string[]> {
  const result: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const current = stack.pop()!
    const children = await prisma.document.findMany({ where: { parentDocumentId: current }, select: { id: true } })
    for (const child of children) {
      result.push(child.id)
      stack.push(child.id)
    }
  }
  return result
}

// GET /api/documents/:id
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: { id, userId },
    include: {
      counterparty: {
        include: {
          signatories: { include: { scopes: true } },
          bankDetails: { take: 1 },
        },
      },
      profile: {
        include: { bankDetails: { take: 1 } },
      },
      versions: {
        orderBy: { number: 'desc' },
        include: { purchase: true },
      },
      parentDocument: { select: { id: true, title: true, number: true } },
      childDocuments: {
        select: { id: true, title: true, number: true, type: true, documentNumber: true },
        orderBy: { documentNumber: 'asc' },
      },
    },
  })

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const safe = JSON.parse(JSON.stringify(doc, (_k, v) => typeof v === 'bigint' ? Number(v) : v))
  return NextResponse.json(safe)
}

// PATCH /api/documents/:id — обновить название, номер, дату
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as { title?: string; number?: string | null; date?: string | null; profileId?: string | null; parentDocumentId?: string | null }

  // Проверка на цикл при привязке к родителю
  if (body.parentDocumentId !== undefined && body.parentDocumentId !== null) {
    if (body.parentDocumentId === id) {
      return NextResponse.json({ error: 'Нельзя привязать документ к самому себе' }, { status: 400 })
    }
    // Убедимся что документ-родитель существует и принадлежит пользователю
    const parent = await prisma.document.findFirst({ where: { id: body.parentDocumentId, userId } })
    if (!parent) return NextResponse.json({ error: 'Родительский документ не найден' }, { status: 404 })
    // Нельзя привязать к своему потомку
    const isDescendant = await checkIsDescendant(body.parentDocumentId, id)
    if (isDescendant) {
      return NextResponse.json({ error: 'Нельзя привязать документ к его потомку' }, { status: 400 })
    }
  }

  const updated = await prisma.document.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.number !== undefined ? { number: body.number || null } : {}),
      ...(body.date !== undefined ? { createdAt: body.date ? new Date(body.date) : undefined } : {}),
      ...(body.profileId !== undefined ? { profileId: body.profileId || null } : {}),
      ...(body.parentDocumentId !== undefined ? { parentDocumentId: body.parentDocumentId } : {}),
    },
  })
  return NextResponse.json(updated)
}

// DELETE /api/documents/:id
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Удаляем документ вместе со всеми потомками (приложения/допсоглашения).
  const descendantIds = await collectDescendantIds(id)
  const allIds = [id, ...descendantIds]

  // FK purchases→versions = ON DELETE RESTRICT: покупку нужно удалить ДО версии,
  // иначе каскад Document→Version упрётся в оплаченную версию и всё удаление
  // упадёт. Записи об оплате в истории платежей не трогаем — их ссылка на версию
  // обнулится автоматически (FK transactions→versions = SET NULL), деньги не
  // возвращаются. Версии и чат уходят каскадом при удалении документа.
  const versions = await prisma.version.findMany({ where: { documentId: { in: allIds } }, select: { id: true } })
  const versionIds = versions.map((v) => v.id)
  await prisma.$transaction([
    prisma.purchase.deleteMany({ where: { versionId: { in: versionIds } } }),
    prisma.document.deleteMany({ where: { id: { in: allIds }, userId } }),
  ])
  return NextResponse.json({ ok: true })
}
