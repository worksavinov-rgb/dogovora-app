import { describe, it, expect } from 'vitest'
import { mergeRankings } from '../src/lib/legal/ranking'

describe('mergeRankings (RRF)', () => {
  it('норма, найденная обоими методами, обходит найденную одним', () => {
    const fts = [{ normId: 'a', score: 10 }, { normId: 'b', score: 5 }]
    const vector = [{ normId: 'a', score: 0.9 }, { normId: 'c', score: 0.8 }]
    expect(mergeRankings(fts, vector)[0].normId).toBe('a')
  })

  it('одинокий слабый результат FTS не получает перевеса над сильным вектором', () => {
    // Здесь ломалась min-max нормализация: единственный элемент списка получал
    // 1.0 и по ОЦЕНКЕ обгонял топ второго метода. В RRF оба — первые в своих
    // списках, поэтому вклад равен, а не в пользу слабого.
    const fts = [{ normId: 'weak', score: 0.0001 }]
    const vector = [
      { normId: 'strong', score: 0.99 },
      { normId: 'mid', score: 0.7 },
      { normId: 'low', score: 0.5 },
    ]
    const merged = mergeRankings(fts, vector)
    const score = (id: string) => merged.find((m) => m.normId === id)!.score
    expect(score('weak')).not.toBeGreaterThan(score('strong'))
    expect(score('weak')).toBeCloseTo(score('strong'), 10)
    // и он точно не вытесняет остальные результаты вектора
    expect(score('mid')).toBeGreaterThan(0)
  })

  it('устойчив к разным шкалам оценок (десятые доли против единиц)', () => {
    const fts = [{ normId: 'a', score: 0.02 }, { normId: 'b', score: 0.01 }]
    const vector = [{ normId: 'b', score: 0.98 }, { normId: 'a', score: 0.97 }]
    const merged = mergeRankings(fts, vector)
    // 'a' первый в FTS и второй в векторе, 'b' наоборот → вклад равен
    expect(merged).toHaveLength(2)
    expect(merged[0].score).toBeCloseTo(merged[1].score, 10)
  })

  it('последний элемент списка не обнуляется', () => {
    const merged = mergeRankings([{ normId: 'a', score: 5 }, { normId: 'b', score: 1 }], [])
    expect(merged.find((m) => m.normId === 'b')!.score).toBeGreaterThan(0)
  })

  it('порядок внутри одного метода сохраняется', () => {
    const merged = mergeRankings(
      [{ normId: 'x', score: 9 }, { normId: 'y', score: 5 }, { normId: 'z', score: 1 }], [],
    )
    expect(merged.map((m) => m.normId)).toEqual(['x', 'y', 'z'])
  })

  it('веса методов влияют на итог', () => {
    const fts = [{ normId: 'f', score: 1 }]
    const vector = [{ normId: 'v', score: 1 }]
    expect(mergeRankings(fts, vector, { ftsWeight: 0.9, vectorWeight: 0.1 })[0].normId).toBe('f')
    expect(mergeRankings(fts, vector, { ftsWeight: 0.1, vectorWeight: 0.9 })[0].normId).toBe('v')
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
