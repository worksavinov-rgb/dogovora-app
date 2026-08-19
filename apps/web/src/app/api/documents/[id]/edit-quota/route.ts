import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getEditQuota } from '@/lib/token-charges'
import { TOKEN_PRICES } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

// GET /api/documents/:id/edit-quota — квота ИИ-правок + цены для UI
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const quota = await getEditQuota(id)
  return NextResponse.json({
    ...quota,
    prices: {
      editPackage: TOKEN_PRICES.editPackage,
      uploadEditStart: TOKEN_PRICES.uploadEditStart,
      generate: TOKEN_PRICES.generate,
      rewrite: TOKEN_PRICES.rewrite,
      review: TOKEN_PRICES.review,
    },
  })
}
