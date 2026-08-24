// Слияние результатов двух методов поиска (полнотекст + вектор) в один рейтинг.
//
// Используется RRF (Reciprocal Rank Fusion): вклад результата определяется его
// ПОЗИЦИЕЙ в своём списке, а не абсолютной оценкой. Это важно, потому что шкалы
// несопоставимы: ts_rank даёт десятые доли, косинусная близость — почти единицу.
// Нормализация min-max на таких данных ведёт себя плохо: единственный (пусть и
// слабый) результат одного метода получал бы максимум 1.0 и обгонял сильный
// результат другого, а худший элемент любого списка всегда обнулялся бы.

export interface ScoredNorm {
  normId: string
  score: number
}

interface MergeOpts {
  ftsWeight?: number
  vectorWeight?: number
  topK?: number
  /** Сглаживание RRF: чем больше, тем меньше разрыв между верхними позициями. */
  k?: number
}

const DEFAULT_K = 60

/** Вклад позиции в списке: 1 / (k + позиция), позиция с единицы. */
function contribute(
  list: ScoredNorm[],
  weight: number,
  k: number,
  into: Map<string, number>,
): void {
  const ordered = [...list].sort((a, b) => b.score - a.score)
  ordered.forEach((item, i) => {
    const add = weight / (k + i + 1)
    into.set(item.normId, (into.get(item.normId) ?? 0) + add)
  })
}

export function mergeRankings(
  fts: ScoredNorm[],
  vector: ScoredNorm[],
  opts: MergeOpts = {},
): ScoredNorm[] {
  const ftsWeight = opts.ftsWeight ?? 0.5
  const vectorWeight = opts.vectorWeight ?? 0.5
  const topK = opts.topK ?? 8
  const k = opts.k ?? DEFAULT_K

  const combined = new Map<string, number>()
  contribute(fts, ftsWeight, k, combined)
  contribute(vector, vectorWeight, k, combined)

  return [...combined.entries()]
    .map(([normId, score]) => ({ normId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
