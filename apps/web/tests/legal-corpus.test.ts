import { describe, it, expect } from 'vitest'
import { LEGAL_EMBEDDING_DIM, buildNormPath, buildFtsInput } from '../src/lib/legal/corpus'

describe('legal corpus helpers', () => {
  it('фиксирует размерность эмбеддинга', () => {
    expect(LEGAL_EMBEDDING_DIM).toBe(1536)
  })

  it('строит путь нормы со статьёй и пунктом', () => {
    expect(buildNormPath('454', '1')).toBe('ст. 454 п. 1')
  })

  it('строит путь нормы без пункта', () => {
    expect(buildNormPath('454', null)).toBe('ст. 454')
  })

  it('склеивает заголовок и текст для FTS с одним пробелом', () => {
    expect(buildFtsInput('Договор', 'купли-продажи')).toBe('Договор купли-продажи')
    expect(buildFtsInput('', 'только текст')).toBe('только текст')
  })
})
