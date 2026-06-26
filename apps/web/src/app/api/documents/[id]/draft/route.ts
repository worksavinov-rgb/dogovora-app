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

  return NextResponse.json(null)
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

  return NextResponse.json({ revision: 1, updatedAt: new Date() })
}

// DELETE /api/documents/:id/draft — удалить рабочую копию (после фиксации версии)
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await assertOwner(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
