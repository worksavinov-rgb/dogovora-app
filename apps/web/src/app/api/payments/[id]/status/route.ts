import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

// GET /api/payments/:id/status — статус платежа для страницы возврата (poll).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payment = await prisma.payment.findFirst({
    where: { id: params.id, userId },
    select: { status: true, creditedAt: true, tokens: true },
  })
  if (!payment) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })

  return NextResponse.json({
    status: payment.status,
    credited: payment.creditedAt !== null,
    tokens: payment.tokens,
  })
}
