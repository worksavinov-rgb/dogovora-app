import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'SIGNED']),
  signedAt: z.string().optional(),
  number: z.string().optional(),
})

// PATCH /api/versions/:id/status — смена статуса версии
// Флоу: DRAFT → IN_PROGRESS → REVIEW → APPROVED → SIGNED (предоплатная модель:
// оплата версии не требуется, PAID — legacy-статус старых оплаченных версий)
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  let data: z.infer<typeof schema>
  try {
    data = schema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (version.status === 'SIGNED') {
    return NextResponse.json({ error: 'Нельзя изменить статус подписанной версии' }, { status: 400 })
  }

  // Подписать можно утверждённую версию (или legacy-оплаченную).
  if (data.status === 'SIGNED' && !['APPROVED', 'PAID'].includes(version.status)) {
    return NextResponse.json({ error: 'Подписать можно только утверждённую версию' }, { status: 400 })
  }

  const updated = await prisma.version.update({
    where: { id },
    data: { status: data.status },
  })

  if (data.status === 'SIGNED') {
    await prisma.document.update({
      where: { id: version.documentId },
      data: {
        ...(data.number ? { number: data.number } : {}),
      },
    })
  }

  return NextResponse.json({ id: updated.id, status: updated.status })
}
