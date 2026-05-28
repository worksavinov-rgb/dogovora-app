import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/history — все версии всех документов пользователя в хронологическом порядке
// ?counterpartyId=... — фильтр по контрагенту
// ?type=CONTRACT|APPENDIX|AMENDMENT — фильтр по типу
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const counterpartyId = url.searchParams.get('counterpartyId')
  const type = url.searchParams.get('type')

  const versions = await prisma.version.findMany({
    where: {
      document: {
        userId,
        ...(counterpartyId ? { counterpartyId } : {}),
        ...(type ? { type: type as 'CONTRACT' | 'APPENDIX' | 'AMENDMENT' } : {}),
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          type: true,
          counterparty: { select: { id: true, name: true } },
        },
      },
      purchase: { select: { id: true, amount: true } },
    },
  })

  // Статистика
  const totalVersions = versions.length
  const paidVersions = versions.filter((v) => v.purchase).length
  const paidAmount = versions
    .filter((v) => v.purchase)
    .reduce((s, v) => s + Number(v.purchase!.amount), 0)

  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      number: v.number,
      status: v.status,
      createdAt: v.createdAt,
      description: (v.aiSettings as { description?: string })?.description ?? null,
      document: v.document,
      purchase: v.purchase ? { amount: Number(v.purchase.amount) } : null,
    })),
    stats: { totalVersions, paidVersions, paidAmount },
  })
}
