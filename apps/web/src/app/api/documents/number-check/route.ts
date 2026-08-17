import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/documents/number-check?profileId=&number=&excludeId=
//
// Дубли номеров не запрещены: у пользователей встречаются одинаковые номера в
// старых бумагах, и запрет сохранения был бы враньём про их же документы. Роут
// нужен, чтобы показать предупреждение со ссылкой на занявший номер документ.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const number = (searchParams.get('number') ?? '').trim()
  const profileId = searchParams.get('profileId')
  const excludeId = searchParams.get('excludeId')

  if (!number || !profileId) return NextResponse.json({ conflict: null })

  const doc = await prisma.document.findFirst({
    where: {
      userId,
      profileId,
      number,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, title: true, counterparty: { select: { name: true } } },
  })

  return NextResponse.json({
    conflict: doc
      ? { id: doc.id, title: doc.title, counterpartyName: doc.counterparty?.name ?? '' }
      : null,
  })
}
