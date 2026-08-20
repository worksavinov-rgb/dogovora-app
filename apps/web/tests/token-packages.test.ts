import { describe, it, expect } from 'vitest'
import { TOKEN_PACKAGES, getPackage, priceKopecks } from '../src/lib/token-packages'

describe('token-packages', () => {
  it('пакеты уникальны, токены и цена положительные', () => {
    expect(TOKEN_PACKAGES.length).toBeGreaterThanOrEqual(3)
    const ids = TOKEN_PACKAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TOKEN_PACKAGES) {
      expect(p.tokens).toBeGreaterThan(0)
      expect(p.priceRub).toBeGreaterThan(0)
      expect(p.label).toBeTruthy()
    }
  })

  it('getPackage находит по id и возвращает undefined для неизвестного', () => {
    const first = TOKEN_PACKAGES[0]
    expect(getPackage(first.id)).toEqual(first)
    expect(getPackage('нет-такого')).toBeUndefined()
  })

  it('priceKopecks = рубли × 100 (целое)', () => {
    expect(priceKopecks({ id: 'x', tokens: 1, priceRub: 300, label: 'x' })).toBe(30000)
  })
})
