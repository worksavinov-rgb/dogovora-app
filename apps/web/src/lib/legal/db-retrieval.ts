// Продовый доступ к юрбазе: обёртка queryRows над Prisma + готовый ретривер.
// Чистая логика поиска живёт в retrieval.ts; здесь только связывание с БД.

import { prisma } from '../db'
import { retrieveNorms, type NormRow, type RetrievedNorm, type RetrieveDeps } from './retrieval'
import { hashEmbedder, type EmbeddingClient } from './embeddings'

type RawClient = {
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
  $executeRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<number>
  $transaction?: <T>(fn: (tx: RawClient) => Promise<T>) => Promise<T>
}

/**
 * Сколько списков ivfflat просматривать. По умолчанию Postgres берёт 1 из lists —
 * при lists=100 это ~1% полноты, то есть векторная половина поиска почти не работает.
 * Значение можно переопределить через LEGAL_IVFFLAT_PROBES.
 */
const DEFAULT_PROBES = 10

function probes(): number {
  const raw = Number.parseInt(process.env['LEGAL_IVFFLAT_PROBES'] ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROBES
}

/** Postgres возвращает ts_rank/float8 по-разному (number | string | Decimal) — приводим к number. */
function toNormRow(raw: Record<string, unknown>): NormRow {
  return {
    id: String(raw.id ?? ''),
    actShortName: String(raw.actShortName ?? ''),
    path: String(raw.path ?? ''),
    title: String(raw.title ?? ''),
    text: String(raw.text ?? ''),
    officialUrl: raw.officialUrl == null ? null : String(raw.officialUrl),
    rank: Number(raw.rank ?? 0),
  }
}

function isVectorQuery(sql: string): boolean {
  return sql.includes('<=>')
}

/** queryRows поверх prisma.$queryRawUnsafe — параметризованно, без интерполяции SQL. */
export function createDbQueryRows(client: RawClient = prisma as unknown as RawClient) {
  return async (sql: string, params: unknown[]): Promise<NormRow[]> => {
    // Векторный запрос идёт в транзакции: SET LOCAL действует только внутри неё,
    // иначе настройка осталась бы на случайном соединении пула.
    if (isVectorQuery(sql) && typeof client.$transaction === 'function') {
      return client.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(`SET LOCAL ivfflat.probes = ${probes()}`)
        const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
        return Array.isArray(rows) ? rows.map(toNormRow) : []
      })
    }
    const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
    return Array.isArray(rows) ? rows.map(toNormRow) : []
  }
}

/** Ретривер норм из реальной БД. Эмбеддер по умолчанию — локальный (без сети). */
export async function retrieveNormsFromDb(
  input: { contractType?: string | null; queryText: string; topK?: number },
  opts: { embedder?: EmbeddingClient; client?: RawClient } = {},
): Promise<RetrievedNorm[]> {
  const deps: RetrieveDeps = {
    queryRows: createDbQueryRows(opts.client),
    embedder: opts.embedder ?? hashEmbedder,
  }
  return retrieveNorms(input, deps)
}
