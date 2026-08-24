/**
 * Строит векторный индекс ПОСЛЕ загрузки норм.
 *
 * Почему не в миграции: ivfflat, созданный на пустой таблице, даёт низкую полноту —
 * Postgres предупреждает об этом прямо при создании («ivfflat index created with
 * little data ... will cause low recall»). Число списков подбирается от размера
 * корпуса, а probes задаётся на стороне запроса.
 *
 * Запуск: DATABASE_URL=... npx tsx scripts/legal/build-vector-index.ts
 */
import { PrismaClient } from '@prisma/client'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL обязателен')
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** Рекомендация pgvector: lists ≈ rows/1000 для корпусов до миллиона строк. */
function listsFor(rows: number): number {
  return Math.max(1, Math.min(2000, Math.round(rows / 1000)))
}

async function main() {
  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM legal_norms WHERE embedding IS NOT NULL`,
  )
  const rows = Number(count)
  if (rows === 0) {
    console.log('Норм с эмбеддингами нет — индекс не строим (сначала сид корпуса).')
    return
  }
  const lists = listsFor(rows)
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "legal_norms_embedding_idx"`)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "legal_norms_embedding_idx" ON legal_norms
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists})`,
  )
  console.log(`Индекс построен: ${rows} норм, lists = ${lists}.`)
  console.log(`Для поиска выставляйте ivfflat.probes ≈ ${Math.max(1, Math.round(Math.sqrt(lists)))}.`)
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
