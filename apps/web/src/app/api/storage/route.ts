import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const PLAN_LIMITS: Record<string, bigint> = {
  STARTER:      BigInt(10 * 1024 * 1024),       // 10 MB
  PROFESSIONAL: BigInt(5 * 1024 * 1024 * 1024), // 5 GB
  BUSINESS:     BigInt(50 * 1024 * 1024 * 1024),// 50 GB
}

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

  // Синхронизируем лимит по плану (исправляет устаревшие записи)
  const correctLimit = PLAN_LIMITS[quota.plan] ?? PLAN_LIMITS.STARTER
  if (quota.limitBytes !== correctLimit) {
    await prisma.storageQuota.update({
      where: { userId },
      data: { limitBytes: correctLimit },
    })
  }
  const limitBytes = Number(correctLimit)

  // Загружаем все версии с fileSize и content по документам пользователя
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
  const totalDocs = docs.length

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
    totalDocs,
    totalVersions,
    breakdown: [
      { type: 'CONTRACT',  label: 'Договоры',       bytes: typeMap.CONTRACT  ?? 0 },
      { type: 'APPENDIX',  label: 'Приложения',      bytes: typeMap.APPENDIX  ?? 0 },
      { type: 'AMENDMENT', label: 'Доп. соглашения', bytes: typeMap.AMENDMENT ?? 0 },
    ],
  })
}
