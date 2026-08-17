import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// За сколько дней до события начинаем показывать напоминание
const HORIZON_DAYS = 45

// GET /api/documents/deadlines — ближайшие сроки по договорам пользователя.
//
// Для каждого документа с датой окончания считаем «дату действия»:
//  * autoRenewal = true: чтобы НЕ продлить договор, заявить об отказе нужно
//    за renewalNoticeDays (дефолт 14) до окончания — значит дедлайн решения
//    наступает раньше самой даты окончания;
//  * autoRenewal = false: договор просто истекает в expiresAt.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000)

  const docs = await prisma.document.findMany({
    where: {
      userId,
      expiresAt: { not: null, lte: horizon },
    },
    select: {
      id: true,
      title: true,
      expiresAt: true,
      autoRenewal: true,
      renewalNoticeDays: true,
      counterparty: { select: { name: true } },
    },
    orderBy: { expiresAt: 'asc' },
    take: 10,
  })

  const items = docs.map((d) => {
    const expiresAt = d.expiresAt as Date
    const noticeDays = d.renewalNoticeDays ?? 14
    // Для автопролонгации ключевая дата — дедлайн отказа, не сама дата окончания
    const actionDate = d.autoRenewal
      ? new Date(expiresAt.getTime() - noticeDays * 86400000)
      : expiresAt
    const daysLeft = Math.ceil((actionDate.getTime() - now.getTime()) / 86400000)
    return {
      documentId: d.id,
      title: d.title,
      counterpartyName: d.counterparty?.name ?? null,
      expiresAt: expiresAt.toISOString(),
      autoRenewal: d.autoRenewal,
      renewalNoticeDays: noticeDays,
      actionDate: actionDate.toISOString(),
      daysLeft,
    }
  })
    // Прошедшие дедлайны отказа при автопролонгации тоже показываем (договор
    // уже «продлился»), но не старше 30 дней — иначе список забьётся прошлым.
    .filter((i) => i.daysLeft > -30)

  return NextResponse.json({ items })
}
