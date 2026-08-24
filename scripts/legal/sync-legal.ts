/**
 * Прогон мониторинга изменений законодательства по API pravo.gov.ru.
 * Читает реестр отслеживаемых актов, ищет законы-поправки, пишет алерты.
 *
 * Запуск: npx tsx scripts/legal/sync-legal.ts [дней_назад]
 * В логи попадают только счётчики и eoNumber — тексты актов не логируются.
 */
import { PrismaClient } from '@prisma/client'
import { searchDocuments } from '../../apps/web/src/lib/legal/pravo-client'
import { syncTrackedActs, type SyncDeps, type TrackedActRecord } from '../../apps/web/src/lib/legal/sync'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL обязателен')
const prisma = new PrismaClient({ datasources: { db: { url } } })

const daysBack = Number.parseInt(process.argv[2] ?? '30', 10)

const deps: SyncDeps = {
  search: (params) => searchDocuments(params),

  loadTracked: async (): Promise<TrackedActRecord[]> => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; shortName: string; number: string; matchPatterns: string[]; lastCheckedAt: Date | null
    }>>(`SELECT id, "shortName", number, "matchPatterns", "lastCheckedAt"
         FROM legal_tracked_acts WHERE "isActive" = true`)
    return rows.map((r) => ({
      id: r.id, shortName: r.shortName, number: r.number,
      matchPatterns: r.matchPatterns ?? [], lastCheckedAt: r.lastCheckedAt,
    }))
  },

  // ON CONFLICT DO NOTHING — алерты append-only и идемпотентны по eoNumber
  saveAlerts: async (trackedActId, hits) => {
    let added = 0
    for (const h of hits) {
      const n = await prisma.$executeRawUnsafe(
        `INSERT INTO legal_change_alerts
           (id,"trackedActId","eoNumber","complexName","documentDate","matchedPattern")
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4::timestamp,$5)
         ON CONFLICT ("trackedActId","eoNumber") DO NOTHING`,
        trackedActId, h.eoNumber, h.complexName, h.documentDate, h.matchedPattern,
      )
      added += Number(n) > 0 ? 1 : 0
    }
    return added
  },

  markChecked: async (trackedActId, at) => {
    await prisma.$executeRawUnsafe(
      `UPDATE legal_tracked_acts SET "lastCheckedAt" = $1::timestamp WHERE id = $2`,
      at.toISOString(), trackedActId,
    )
  },
}

async function main() {
  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000)
  const report = await syncTrackedActs(deps, { defaultSince: since })
  console.log(`Просмотрено документов: ${report.scannedDocuments} (страниц: ${report.pagesFetched})`)
  console.log(`Новых алертов: ${report.totalNewAlerts}`)
  for (const [act, n] of Object.entries(report.newAlertsByAct)) {
    if (n > 0) console.log(`  ${act}: ${n}`)
  }
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
