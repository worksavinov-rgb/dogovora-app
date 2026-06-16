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

// GET /api/documents/:id
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
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
  const userId = getUserId(req)
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
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: { id, userId },
    include: { versions: { include: { purchase: true } } },
  })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hasPaidVersion = doc.versions.some((v) => v.purchase)
  if (hasPaidVersion) {
    return NextResponse.json({ error: 'Нельзя удалить документ с оплаченными версиями' }, { status: 403 })
  }

  await prisma.document.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
