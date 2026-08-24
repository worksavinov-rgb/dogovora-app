import { describe, it, expect } from 'vitest'
import { mergeRankings } from '../src/lib/legal/ranking'

describe('mergeRankings', () => {
  it('норма, найденная обоими методами, обходит найденную одним', () => {
    const fts = [{ normId: 'a', score: 10 }, { normId: 'b', score: 5 }]
    const vector = [{ normId: 'a', score: 0.9 }, { normId: 'c', score: 0.8 }]
    const merged = mergeRankings(fts, vector)
    expect(merged[0].normId).toBe('a')
  })

  it('нормализует разные шкалы (FTS в десятках, вектор в долях)', () => {
    const fts = [{ normId: 'a', score: 100 }]
    const vector = [{ normId: 'b', score: 0.99 }]
    const merged = mergeRankings(fts, vector, { ftsWeight: 0.5, vectorWeight: 0.5 })
    // оба — единственные лидеры своих списков → нормализуются в 1 → равный вес
    expect(merged.find((m) => m.normId === 'a')!.score).toBeCloseTo(0.5)
    expect(merged.find((m) => m.normId === 'b')!.score).toBeCloseTo(0.5)
  })

  it('режет до topK', () => {
    const fts = [
      { normId: 'a', score: 5 }, { normId: 'b', score: 4 },
      { normId: 'c', score: 3 }, { normId: 'd', score: 2 },
    ]
    expect(mergeRankings(fts, [], { topK: 2 })).toHaveLength(2)
  })

  it('пустые входы → пустой выход', () => {
    expect(mergeRankings([], [])).toEqual([])
  })
})
