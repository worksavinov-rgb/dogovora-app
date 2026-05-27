import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/storage — информация об использовании хранилища
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Lazy init квоты
  const quota = await prisma.storageQuota.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })

  // Считаем реальное использование: сумма fileSize по всем версиям пользователя
  const agg = await prisma.version.aggregate({
    where: { document: { userId }, fileSize: { not: null } },
    _sum: { fileSize: true },
  })

  // Считаем по типам документов
  const byType = await prisma.document.findMany({
    where: { userId },
    select: {
      type: true,
      versions: {
        select: { fileSize: true },
        where: { fileSize: { not: null } },
      },
    },
  })

  const typeMap: Record<string, number> = { CONTRACT: 0, APPENDIX: 0, AMENDMENT: 0 }
  for (const doc of byType) {
    const sum = doc.versions.reduce((s, v) => s + (v.fileSize ?? 0), 0)
    typeMap[doc.type] = (typeMap[doc.type] ?? 0) + sum
  }

  const usedBytes = Number(agg._sum.fileSize ?? 0)
  const limitBytes = Number(quota.limitBytes)

  // Обновляем usedBytes в квоте
  await prisma.storageQuota.update({
    where: { userId },
    data: { usedBytes },
  })

  return NextResponse.json({
    plan: quota.plan,
    usedBytes,
    limitBytes,
    percent: limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 100) : 0,
    breakdown: [
      { type: 'CONTRACT',  label: 'Договоры',        bytes: typeMap.CONTRACT  ?? 0 },
      { type: 'APPENDIX',  label: 'Приложения',       bytes: typeMap.APPENDIX  ?? 0 },
      { type: 'AMENDMENT', label: 'Доп. соглашения',  bytes: typeMap.AMENDMENT ?? 0 },
    ],
  })
}
