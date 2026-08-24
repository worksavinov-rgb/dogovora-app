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
