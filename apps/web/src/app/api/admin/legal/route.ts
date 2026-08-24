import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'

// Сырой SQL, а не типизированный клиент: модели юрбазы появились недавно,
// и роут не должен зависеть от того, перегенерирован ли Prisma-клиент.

interface ActRow {
  id: string
  shortName: string
  number: string
  lastCheckedAt: Date | null
  isActive: boolean
  alertCount: bigint
  newCount: bigint
}

interface AlertRow {
  id: string
  actShortName: string
  eoNumber: string
  complexName: string
  documentDate: Date
  status: string
}

const ALERTS_LIMIT = 100

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const acts = await prisma.$queryRawUnsafe<ActRow[]>(`
    SELECT t.id, t."shortName", t.number, t."lastCheckedAt", t."isActive",
           count(a.id) AS "alertCount",
           count(a.id) FILTER (WHERE a.status = 'NEW') AS "newCount"
    FROM legal_tracked_acts t
    LEFT JOIN legal_change_alerts a ON a."trackedActId" = t.id
    GROUP BY t.id
    ORDER BY t."shortName"
  `)

  const alerts = await prisma.$queryRawUnsafe<AlertRow[]>(`
    SELECT a.id, t."shortName" AS "actShortName", a."eoNumber", a."complexName",
           a."documentDate", a.status
    FROM legal_change_alerts a
    JOIN legal_tracked_acts t ON t.id = a."trackedActId"
    ORDER BY a."documentDate" DESC, a."eoNumber" DESC
    LIMIT ${ALERTS_LIMIT}
  `)

  const [norms] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM legal_norms`,
  )

  return NextResponse.json({
    acts: acts.map((a) => ({
      id: a.id,
      shortName: a.shortName,
      number: a.number,
      lastCheckedAt: a.lastCheckedAt,
      isActive: a.isActive,
      alertCount: Number(a.alertCount),
      newCount: Number(a.newCount),
    })),
    alerts: alerts.map((a) => ({
      id: a.id,
      actShortName: a.actShortName,
      eoNumber: a.eoNumber,
      // Название приходит с переносом строки между «Федеральный закон …» и кавычками
      complexName: a.complexName.replace(/\s+/g, ' ').trim(),
      documentDate: a.documentDate,
      status: a.status,
      sourceUrl: `http://publication.pravo.gov.ru/document/${a.eoNumber}`,
    })),
    normsCount: Number(norms?.count ?? 0),
    alertsLimit: ALERTS_LIMIT,
  })
}
