import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/wallet — текущий баланс + кошелёк
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Создаём кошелёк если не существует (lazy init)
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  })

  return NextResponse.json({
    id: wallet.id,
    balance: Number(wallet.balance),
  })
}
