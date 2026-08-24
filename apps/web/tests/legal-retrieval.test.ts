import { describe, it, expect, vi } from 'vitest'
import { retrieveNorms } from '../src/lib/legal/retrieval'
import { hashEmbedder } from '../src/lib/legal/embeddings'

function fakeRows(kind: 'fts' | 'vector') {
  // FTS находит норму про неустойку; вектор — про ответственность
  if (kind === 'fts') {
    return [
      { id: 'n1', actShortName: 'ГК РФ', path: 'ст. 330', title: 'Неустойка', text: '...', officialUrl: null, rank: 0.9 },
    ]
  }
  return [
    { id: 'n1', actShortName: 'ГК РФ', path: 'ст. 330', title: 'Неустойка', text: '...', officialUrl: null, rank: 0.7 },
    { id: 'n2', actShortName: 'ГК РФ', path: 'ст. 401', title: 'Основания ответственности', text: '...', officialUrl: null, rank: 0.6 },
  ]
}

describe('retrieveNorms', () => {
  it('сливает FTS и вектор, норма из обоих — первой', async () => {
    const queryRows = vi.fn(async (sql: string) =>
      sql.includes('<=>') ? fakeRows('vector') : fakeRows('fts'),
    )
    const res = await retrieveNorms(
      { contractType: 'supply', queryText: 'неустойка ответственность' },
      { queryRows, embedder: hashEmbedder },
    )
    expect(res[0].normId).toBe('n1')
    expect(res.map((r) => r.normId)).toContain('n2')
    // два запроса: FTS и векторный
    expect(queryRows).toHaveBeenCalledTimes(2)
  })

  it('пустой queryText → пустой результат без запросов', async () => {
    const queryRows = vi.fn(async () => [])
    const res = await retrieveNorms(
      { queryText: '   ' },
      { queryRows, embedder: hashEmbedder },
    )
    expect(res).toEqual([])
    expect(queryRows).not.toHaveBeenCalled()
  })

  it('падение эмбеддера → работает только на FTS', async () => {
    const queryRows = vi.fn(async () => fakeRows('fts'))
    const brokenEmbedder = { embed: async () => { throw new Error('нет оператора') } }
    const res = await retrieveNorms(
      { queryText: 'неустойка' },
      { queryRows, embedder: brokenEmbedder },
    )
    expect(res).toHaveLength(1)
    expect(res[0].normId).toBe('n1')
    // только FTS-запрос
    expect(queryRows).toHaveBeenCalledTimes(1)
  })
})

describe('retrieveNorms — краевые случаи', () => {
  it('вырожденный (нулевой) вектор в БД не отправляется', async () => {
    // <=> с нулевым вектором даёт NaN, NaN отравляет нормализацию и порядок выдачи.
    const queryRows = vi.fn(async () => fakeRows('fts'))
    const zeroEmbedder = { embed: async () => [new Array(1536).fill(0)] }
    const res = await retrieveNorms(
      { queryText: '!!! ???' },
      { queryRows, embedder: zeroEmbedder },
    )
    expect(queryRows).toHaveBeenCalledTimes(1) // только FTS, векторного запроса нет
    expect(res.every((r) => Number.isFinite(r.score))).toBe(true)
  })

  it('опечатка в типе договора снимает фильтр, а не сужает до одного акта', async () => {
    let actsParam: unknown = 'не вызывали'
    const queryRows = vi.fn(async (_sql: string, params: unknown[]) => {
      actsParam = params[1]
      return fakeRows('fts')
    })
    await retrieveNorms(
      { contractType: 'suply', queryText: 'поставка' }, // опечатка
      { queryRows, embedder: hashEmbedder },
    )
    expect(actsParam).toBeNull()
  })

  it('известный тип договора фильтр применяет', async () => {
    let actsParam: unknown = null
    const queryRows = vi.fn(async (_sql: string, params: unknown[]) => {
      actsParam = params[1]
      return fakeRows('fts')
    })
    await retrieveNorms(
      { contractType: 'supply', queryText: 'поставка' },
      { queryRows, embedder: hashEmbedder },
    )
    expect(Array.isArray(actsParam)).toBe(true)
    expect(actsParam as string[]).toContain('ГК РФ')
  })
})
