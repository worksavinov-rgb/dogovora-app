import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import {
  formatScope,
  nextNumber,
  periodFromDateString,
  renderNumber,
  SCOPE_LABELS,
} from '@/lib/document-number'

// GET /api/profiles/:id/next-number?date=YYYY-MM-DD
//
// Следующий свободный номер договора для этого юрлица. Счётчик нигде не
// хранится — он выводится из номеров уже существующих договоров, поэтому
// вручную вписанный номер продолжается, а отменённое создание документа
// не оставляет дырок.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const profile = await prisma.profile.findFirst({
    where: { id, userId },
    select: { contractNumberFormat: true },
  })
  if (!profile) return NextResponse.json({ error: 'Профиль не найден' }, { status: 404 })

  const tpl = profile.contractNumberFormat?.trim()
  if (!tpl) {
    return NextResponse.json({ format: null, next: null, scope: null, scopeLabel: null, sample: null })
  }

  const { searchParams } = new URL(req.url)
  const date = periodFromDateString(searchParams.get('date'))

  // Приложения и допсоглашения наследуют номер родителя и собственный счётчик
  // не тратят, поэтому в выборку идут только договоры.
  const docs = await prisma.document.findMany({
    where: { userId, profileId: id, type: 'CONTRACT', number: { not: null } },
    select: { number: true },
  })

  const scope = formatScope(tpl)
  return NextResponse.json({
    format: tpl,
    next: nextNumber(
      tpl,
      docs.map((d) => d.number),
      date,
    ),
    scope,
    scopeLabel: SCOPE_LABELS[scope],
    sample: renderNumber(tpl, 1, date),
  })
}
