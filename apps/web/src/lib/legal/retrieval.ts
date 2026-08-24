// Гибридный ретривер норм: полнотекст (FTS) + вектор (pgvector), слияние ре-ранком.
// SQL выполняется через внедряемый queryRows (в проде — обёртка над prisma.$queryRawUnsafe),
// чтобы модуль тестировался без живой БД.

import { mergeRankings, type ScoredNorm } from './ranking'
import { actsForContractType } from './contract-types'
import type { EmbeddingClient } from './embeddings'

export interface NormRow {
  id: string
  actShortName: string
  path: string
  title: string
  text: string
  officialUrl: string | null
  rank: number
}

export interface RetrievedNorm {
  normId: string
  actShortName: string
  path: string
  title: string
  text: string
  officialUrl: string | null
  score: number
}

export interface RetrieveDeps {
  queryRows: (sql: string, params: unknown[]) => Promise<NormRow[]>
  embedder: EmbeddingClient
}

const FTS_SQL = `
  SELECT n.id, a."shortName" AS "actShortName", n.path, n.title, n.text,
         a."officialUrl" AS "officialUrl",
         ts_rank(n.fts, plainto_tsquery('russian', $1)) AS rank
  FROM legal_norms n
  JOIN legal_act_editions e ON e.id = n."editionId" AND e."isCurrent" = true
  JOIN legal_acts a ON a.id = e."actId"
  WHERE n.fts @@ plainto_tsquery('russian', $1)
    AND ($2::text[] IS NULL OR a."shortName" = ANY($2::text[]))
  ORDER BY rank DESC
  LIMIT $3
`

const VECTOR_SQL = `
  SELECT n.id, a."shortName" AS "actShortName", n.path, n.title, n.text,
         a."officialUrl" AS "officialUrl",
         1 - (n.embedding <=> $1::vector) AS rank
  FROM legal_norms n
  JOIN legal_act_editions e ON e.id = n."editionId" AND e."isCurrent" = true
  JOIN legal_acts a ON a.id = e."actId"
  WHERE n.embedding IS NOT NULL
    AND ($2::text[] IS NULL OR a."shortName" = ANY($2::text[]))
  ORDER BY n.embedding <=> $1::vector
  LIMIT $3
`

function toScored(rows: NormRow[]): ScoredNorm[] {
  return rows.map((r) => ({ normId: r.id, score: r.rank }))
}

export async function retrieveNorms(
  input: { contractType?: string | null; queryText: string; topK?: number },
  deps: RetrieveDeps,
): Promise<RetrievedNorm[]> {
  const query = input.queryText.trim()
  if (!query) return []

  const topK = input.topK ?? 8
  const perMethod = topK * 3
  // null → без пред-фильтра по акту; иначе массив shortName
  const acts = input.contractType ? actsForContractType(input.contractType) : null

  const ftsRows = await deps.queryRows(FTS_SQL, [query, acts, perMethod])

  let vectorRows: NormRow[] = []
  try {
    const [vec] = await deps.embedder.embed([query])
    if (vec && vec.length > 0) {
      const vecLiteral = `[${vec.join(',')}]`
      vectorRows = await deps.queryRows(VECTOR_SQL, [vecLiteral, acts, perMethod])
    }
  } catch {
    // эмбеддинг-оператор недоступен — деградируем до FTS-only
    vectorRows = []
  }

  const merged = mergeRankings(toScored(ftsRows), toScored(vectorRows), { topK })

  const byId = new Map<string, NormRow>()
  for (const r of [...ftsRows, ...vectorRows]) byId.set(r.id, r)

  return merged
    .map((m) => {
      const row = byId.get(m.normId)
      if (!row) return null
      return {
        normId: row.id,
        actShortName: row.actShortName,
        path: row.path,
        title: row.title,
        text: row.text,
        officialUrl: row.officialUrl,
        score: m.score,
      }
    })
    .filter((x): x is RetrievedNorm => x !== null)
}
