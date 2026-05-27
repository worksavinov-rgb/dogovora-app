import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/wallet/transactions — история операций
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const wallet = await prisma.wallet.findUnique({ where: { userId } })
  if (!wallet) return NextResponse.json([])

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)
  const offset = Number(url.searchParams.get('offset') ?? 0)

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        relatedVersion: {
          include: { document: { select: { title: true } } },
        },
      },
    }),
    prisma.transaction.count({ where: { walletId: wallet.id } }),
  ])

  return NextResponse.json({
    items: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      description: t.description,
      createdAt: t.createdAt,
      document: t.relatedVersion?.document?.title ?? null,
    })),
    total,
    balance: Number(wallet.balance),
  })
}
