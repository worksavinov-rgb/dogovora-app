import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/storage — сколько места занимают документы пользователя.
//
// Решение владельца (2026-08-17): хранилище НЕ продаём — тарифов, лимитов и
// процентов нет, каждый хранит сколько нужно. Показываем только факт:
// занято всего + разбивка по типам документов. Оплата по занимаемому месту
// появится позже — тогда вернутся и лимиты.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Считаем по fileSize; content подтягиваем только как запасной вариант для
  // старых версий без fileSize (грузить все тексты в память ради подсчёта —
  // дорого, поэтому берём длину только там, где размера нет).
  const docs = await prisma.document.findMany({
    where: { userId },
    select: {
      type: true,
      versions: {
        select: { fileSize: true, content: true },
      },
    },
  })

  const typeMap: Record<string, number> = { CONTRACT: 0, APPENDIX: 0, AMENDMENT: 0 }
  let totalVersions = 0

  for (const doc of docs) {
    for (const ver of doc.versions) {
      totalVersions++
      let bytes = ver.fileSize ?? 0
      if (!ver.fileSize && ver.content) {
        bytes = Buffer.byteLength(ver.content, 'utf8')
      }
      typeMap[doc.type] = (typeMap[doc.type] ?? 0) + bytes
    }
  }

  const usedBytes = Object.values(typeMap).reduce((s, b) => s + b, 0)

  // Квоту продолжаем актуализировать — пригодится при вводе оплаты за место.
  await prisma.storageQuota.upsert({
    where: { userId },
    create: { userId, usedBytes },
    update: { usedBytes },
  })

  return NextResponse.json({
    usedBytes,
    totalDocs: docs.length,
    totalVersions,
    breakdown: [
      { type: 'CONTRACT',  label: 'Договоры',       bytes: typeMap.CONTRACT  ?? 0 },
      { type: 'APPENDIX',  label: 'Приложения',      bytes: typeMap.APPENDIX  ?? 0 },
      { type: 'AMENDMENT', label: 'Доп. соглашения', bytes: typeMap.AMENDMENT ?? 0 },
    ],
  })
}
