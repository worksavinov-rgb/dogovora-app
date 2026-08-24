/**
 * Интеграционная проверка юрбазы на ЖИВОЙ Postgres+pgvector.
 * Закрывает то, что нельзя проверить на моках:
 *   1) сериализацию string[] в text[] при $queryRawUnsafe (пред-фильтр по актам);
 *   2) формат вектор-литерала (в т.ч. экспоненциальную запись малых компонент);
 *   3) сквозной путь FTS + вектор + слияние.
 *
 * Запуск: DATABASE_URL=postgresql://... npx tsx scripts/legal/verify-db-retrieval.ts
 */
import { PrismaClient } from '@prisma/client'
import { createDbQueryRows } from '../../apps/web/src/lib/legal/db-retrieval'
import { retrieveNorms } from '../../apps/web/src/lib/legal/retrieval'
import { hashEmbedder } from '../../apps/web/src/lib/legal/embeddings'
import { LEGAL_EMBEDDING_DIM } from '../../apps/web/src/lib/legal/corpus'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL обязателен')

const prisma = new PrismaClient({ datasources: { db: { url } } })

function fail(msg: string): never {
  console.error('❌ ' + msg)
  process.exit(1)
}

async function main() {
  const q = createDbQueryRows(prisma as never)

  // ── подготовка данных ──────────────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    INSERT INTO legal_acts (id,kind,"shortName",number,title,"officialUrl")
    VALUES ('a-gk','CODE','ГК РФ','51-ФЗ','Гражданский кодекс','http://pravo.gov.ru/gk'),
           ('a-tk','CODE','ТК РФ','197-ФЗ','Трудовой кодекс','http://pravo.gov.ru/tk')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO legal_act_editions (id,"actId","editionDate","isCurrent")
    VALUES ('e-gk','a-gk',now(),true), ('e-tk','a-tk',now(),true),
           ('e-gk-old','a-gk','2020-01-01',false)
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO legal_norms (id,"editionId",path,"articleNumber",title,text) VALUES
      ('n-330','e-gk','ст. 330','330','Понятие неустойки','Неустойкой признается определенная законом или договором денежная сумма за просрочку исполнения'),
      ('n-401','e-gk','ст. 401','401','Основания ответственности','Лицо несет ответственность при наличии вины за неисполнение обязательства'),
      ('n-tk','e-tk','ст. 57','57','Содержание трудового договора','Обязательные условия трудового договора'),
      ('n-old','e-gk-old','ст. 999','999','Старая редакция','Неустойка в старой недействующей редакции')
  `)

  // эмбеддинги: включаем экспоненциальную запись, чтобы проверить парсер pgvector
  for (const [id, text] of [
    ['n-330', 'неустойка просрочка договор'],
    ['n-401', 'ответственность вина обязательство'],
    ['n-tk', 'трудовой договор условия'],
    ['n-old', 'неустойка старая'],
  ] as const) {
    const [vec] = await hashEmbedder.embed([text])
    if (vec.length !== LEGAL_EMBEDDING_DIM) fail('размерность вектора не совпала')
    const withTiny = [...vec]
    withTiny[0] = 1e-7 // намеренно малое значение → toString даёт "1e-7"
    const lit = `[${withTiny.join(',')}]`
    if (!lit.includes('e-7')) fail('в литерале нет экспоненциальной записи — тест бессмыслен')
    await prisma.$executeRawUnsafe(`UPDATE legal_norms SET embedding = $1::vector WHERE id = $2`, lit, id)
  }
  console.log('✅ 1/5 вектор-литерал с экспоненциальной записью (1e-7) принят pgvector')

  // ── проверка text[] пред-фильтра ───────────────────────────────────────────
  const FTS = `
    SELECT n.id, a."shortName" AS "actShortName", n.path, n.title, n.text,
           a."officialUrl" AS "officialUrl",
           ts_rank(n.fts, plainto_tsquery('russian', $1)) AS rank
    FROM legal_norms n
    JOIN legal_act_editions e ON e.id = n."editionId" AND e."isCurrent" = true
    JOIN legal_acts a ON a.id = e."actId"
    WHERE n.fts @@ plainto_tsquery('russian', $1)
      AND ($2::text[] IS NULL OR a."shortName" = ANY($2::text[]))
    ORDER BY rank DESC LIMIT $3`

  const filtered = await q(FTS, ['договор', ['ГК РФ'], 10])
  if (filtered.length === 0) fail('пред-фильтр text[] вернул пусто — сериализация массива сломана')
  if (filtered.some((r) => r.actShortName !== 'ГК РФ')) fail('пред-фильтр пропустил чужой акт')
  console.log(`✅ 2/5 пред-фильтр string[] → text[] работает (${filtered.length} норм, только ГК РФ)`)

  const unfiltered = await q(FTS, ['договор', null, 10])
  if (!unfiltered.some((r) => r.actShortName === 'ТК РФ')) fail('без фильтра ТК РФ не найден')
  console.log(`✅ 3/5 null-фильтр отдаёт все акты (${unfiltered.length} норм, включая ТК РФ)`)

  // ── isCurrent: старая редакция не должна попадать ──────────────────────────
  const all = await q(FTS, ['неустойка', null, 10])
  if (all.some((r) => r.id === 'n-old')) fail('норма из НЕтекущей редакции попала в выдачу')
  if (!all.some((r) => r.id === 'n-330')) fail('норма из текущей редакции не найдена')
  console.log('✅ 4/5 фильтр isCurrent отсекает старые редакции')

  // ── сквозной ретривер ──────────────────────────────────────────────────────
  const res = await retrieveNorms(
    { contractType: 'supply', queryText: 'неустойка за просрочку', topK: 5 },
    { queryRows: q, embedder: hashEmbedder },
  )
  if (res.length === 0) fail('сквозной ретривер вернул пусто')
  if (res[0].normId !== 'n-330') fail(`ожидалась ст.330 первой, получено ${res[0].normId}`)
  if (res.some((r) => r.actShortName === 'ТК РФ')) fail('supply-фильтр пропустил ТК РФ')
  console.log(`✅ 5/5 сквозной ретривер: топ = ${res[0].path} «${res[0].title}» (score ${res[0].score.toFixed(3)})`)

  console.log('\nALL_INTEGRATION_CHECKS_PASSED')
}

main()
  .catch((e) => { console.error('❌ ОШИБКА:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
