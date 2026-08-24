/**
 * Заполняет реестр отслеживаемых актов (legal_tracked_acts) из CORE_ACTS.
 * Идемпотентно: повторный запуск обновляет шаблоны, не плодя дубли.
 *
 * Запуск: npx tsx scripts/legal/seed-tracked-acts.ts
 */
import { PrismaClient } from '@prisma/client'
import { CORE_ACTS } from '../../apps/web/src/lib/legal/core-acts'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL обязателен')
const prisma = new PrismaClient({ datasources: { db: { url } } })

async function main() {
  let inserted = 0
  let updated = 0
  for (const act of CORE_ACTS) {
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM legal_tracked_acts WHERE "shortName" = $1`, act.shortName,
    )
    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE legal_tracked_acts SET "matchPatterns" = $1::text[], number = $2 WHERE "shortName" = $3`,
        act.matchPatterns, act.number, act.shortName,
      )
      updated += 1
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO legal_tracked_acts (id,"shortName",number,"matchPatterns") VALUES (gen_random_uuid()::text,$1,$2,$3::text[])`,
        act.shortName, act.number, act.matchPatterns,
      )
      inserted += 1
    }
  }
  console.log(`Реестр отслеживаемых актов: добавлено ${inserted}, обновлено ${updated}`)
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
