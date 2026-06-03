import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const putSchema = z.object({
  content: z.string().max(5_000_000),
  baseVersionId: z.string().optional(),
  revision: z.number().int().optional(),
})

async function assertOwner(documentId: string, userId: string) {
  return prisma.document.findFirst({ where: { id: documentId, userId }, select: { id: true } })
}

// GET /api/documents/:id/draft — рабочая копия (или null, если ещё не сохранялась)
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await assertOwner(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const draft = await prisma.documentDraft.findUnique({ where: { documentId: id } })
  if (!draft) return NextResponse.json(null)

  return NextResponse.json({
    content: draft.content,
    revision: draft.revision,
    baseVersionId: draft.baseVersionId,
    updatedAt: draft.updatedAt,
  })
}

// PUT /api/documents/:id/draft — автосохранение рабочей копии (upsert)
export async function PUT(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await assertOwner(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let data: z.infer<typeof putSchema>
  try {
    data = putSchema.parse(await req.json())
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const existing = await prisma.documentDraft.findUnique({ where: { documentId: id } })

  // Optimistic-lock: если клиент прислал revision и он не совпал — конфликт (другая вкладка)
  if (existing && typeof data.revision === 'number' && existing.revision !== data.revision) {
    return NextResponse.json(
      { error: 'conflict', current: { revision: existing.revision, content: existing.content } },
      { status: 409 },
    )
  }

  const nextRevision = (existing?.revision ?? 0) + 1
  const draft = await prisma.documentDraft.upsert({
    where: { documentId: id },
    create: {
      documentId: id,
      content: data.content,
      baseVersionId: data.baseVersionId,
      revision: nextRevision,
    },
    update: {
      content: data.content,
      baseVersionId: data.baseVersionId ?? existing?.baseVersionId,
      revision: nextRevision,
    },
  })

  return NextResponse.json({ revision: draft.revision, updatedAt: draft.updatedAt })
}

// DELETE /api/documents/:id/draft — удалить рабочую копию (после фиксации версии)
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await assertOwner(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.documentDraft.deleteMany({ where: { documentId: id } })
  return NextResponse.json({ ok: true })
}
