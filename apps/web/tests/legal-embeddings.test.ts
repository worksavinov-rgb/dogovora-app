import { describe, it, expect } from 'vitest'
import { hashEmbedder } from '../src/lib/legal/embeddings'
import { LEGAL_EMBEDDING_DIM } from '../src/lib/legal/corpus'

describe('hashEmbedder', () => {
  it('возвращает вектор фиксированной длины на каждый вход', async () => {
    const [v] = await hashEmbedder.embed(['договор поставки'])
    expect(v).toHaveLength(LEGAL_EMBEDDING_DIM)
  })

  it('детерминирован: один текст → один вектор', async () => {
    const [a] = await hashEmbedder.embed(['неустойка'])
    const [b] = await hashEmbedder.embed(['неустойка'])
    expect(a).toEqual(b)
  })

  it('похожие тексты ближе, чем непохожие (косинус)', async () => {
    const [a, b, c] = await hashEmbedder.embed([
      'ответственность сторон неустойка',
      'неустойка ответственность сторон',
      'банковские реквизиты счёт',
    ])
    const cos = (x: number[], y: number[]) => x.reduce((s, xi, i) => s + xi * y[i], 0)
    expect(cos(a, b)).toBeGreaterThan(cos(a, c))
  })

  it('L2-норма ≈ 1', async () => {
    const [v] = await hashEmbedder.embed(['аренда'])
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
  })
})
