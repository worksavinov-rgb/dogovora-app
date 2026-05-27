import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/documents/:id
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: { id, userId },
    include: {
      counterparty: {
        include: { signatories: { include: { scopes: true } } },
      },
      versions: {
        orderBy: { number: 'desc' },
        include: { purchase: true },
      },
    },
  })

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(doc)
}

// DELETE /api/documents/:id
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.document.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
