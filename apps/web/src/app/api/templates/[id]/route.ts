import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
})

// GET /api/templates/:id — полный шаблон с content
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const template = await prisma.documentTemplate.findFirst({ where: { id, userId } })
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(template)
}

// PATCH /api/templates/:id — переименовать или обновить содержимое
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const template = await prisma.documentTemplate.findFirst({ where: { id, userId } })
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof updateSchema>
  try {
    data = updateSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const updated = await prisma.documentTemplate.update({
    where: { id },
    data,
  })

  return NextResponse.json(updated)
}

// DELETE /api/templates/:id — удалить шаблон
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const template = await prisma.documentTemplate.findFirst({ where: { id, userId } })
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.documentTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
