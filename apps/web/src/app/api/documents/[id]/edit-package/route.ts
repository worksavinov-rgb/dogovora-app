import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { chargeTokens, getEditQuota, InsufficientTokensError, insufficientTokensResponse } from '@/lib/token-charges'
import { TOKEN_PRICES, EDITS_PER_PACKAGE } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

// POST /api/documents/:id/edit-package — докупить пакет ИИ-правок
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true, title: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const res = await chargeTokens({
      userId,
      kind: 'EDIT_PACKAGE',
      tokens: TOKEN_PRICES.editPackage,
      documentId: id,
      description: `Пакет ${EDITS_PER_PACKAGE} ИИ-правок: ${doc.title}`,
    })
    const quota = await getEditQuota(id)
    return NextResponse.json({ ok: true, balance: res.balance, quota }, { status: 201 })
  } catch (err) {
    if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
    throw err
  }
}
