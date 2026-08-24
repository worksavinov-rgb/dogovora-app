// Продовый доступ к юрбазе: обёртка queryRows над Prisma + готовый ретривер.
// Чистая логика поиска живёт в retrieval.ts; здесь только связывание с БД.

import { prisma } from '../db'
import { retrieveNorms, type NormRow, type RetrievedNorm, type RetrieveDeps } from './retrieval'
import { hashEmbedder, type EmbeddingClient } from './embeddings'

type RawClient = {
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
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

/** queryRows поверх prisma.$queryRawUnsafe — параметризованно, без интерполяции SQL. */
export function createDbQueryRows(client: RawClient = prisma as unknown as RawClient) {
  return async (sql: string, params: unknown[]): Promise<NormRow[]> => {
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
