// Слияние результатов двух методов поиска (полнотекст + вектор) в один рейтинг.

export interface ScoredNorm {
  normId: string
  score: number
}

interface MergeOpts {
  ftsWeight?: number
  vectorWeight?: number
  topK?: number
}

/** min-max нормализация оценок списка в [0,1]. Если все равны — все получают 1. */
function normalize(list: ScoredNorm[]): Map<string, number> {
  const out = new Map<string, number>()
  if (list.length === 0) return out
  const scores = list.map((s) => s.score)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const span = max - min
  for (const item of list) {
    out.set(item.normId, span === 0 ? 1 : (item.score - min) / span)
  }
  return out
}

export function mergeRankings(
  fts: ScoredNorm[],
  vector: ScoredNorm[],
  opts: MergeOpts = {},
): ScoredNorm[] {
  const ftsWeight = opts.ftsWeight ?? 0.5
  const vectorWeight = opts.vectorWeight ?? 0.5
  const topK = opts.topK ?? 8

  const ftsNorm = normalize(fts)
  const vectorNorm = normalize(vector)

  const combined = new Map<string, number>()
  for (const [id, s] of ftsNorm) {
    combined.set(id, (combined.get(id) ?? 0) + s * ftsWeight)
  }
  for (const [id, s] of vectorNorm) {
    combined.set(id, (combined.get(id) ?? 0) + s * vectorWeight)
  }

  return [...combined.entries()]
    .map(([normId, score]) => ({ normId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
