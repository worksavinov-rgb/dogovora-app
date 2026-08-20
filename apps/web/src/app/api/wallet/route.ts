import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { TOKEN_PRICES, EDITS_PER_PACKAGE } from '@/lib/token-pricing'

// GET /api/wallet — текущий баланс (в токенах) + прайс действий для UI
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
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
    currency: 'TOKEN',
    prices: {
      generate: TOKEN_PRICES.generate,
      uploadEditStart: TOKEN_PRICES.uploadEditStart,
      editPackage: TOKEN_PRICES.editPackage,
      review: TOKEN_PRICES.review,
      analyzeUpload: TOKEN_PRICES.analyzeUpload,
      editsPerPackage: EDITS_PER_PACKAGE,
    },
  })
}
