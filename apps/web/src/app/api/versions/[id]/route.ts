import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id — полная информация о версии включая content
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          type: true,
          counterparty: { select: { id: true, name: true } },
        },
      },
      purchase: true,
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: version.id,
    number: version.number,
    status: version.status,
    content: version.content,
    fileSize: version.fileSize,
    aiSettings: version.aiSettings,
    createdAt: version.createdAt,
    document: version.document,
    purchase: version.purchase,
  })
}
