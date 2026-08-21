import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('envRub — переопределение цены через TOKEN_PACKAGE_<ID>_RUB', () => {
  const KEY = 'TOKEN_PACKAGE_START_RUB'
  const ORIGINAL = process.env[KEY]

  beforeEach(() => {
    vi.resetModules()
    delete process.env[KEY]
  })

  afterEach(() => {
    vi.resetModules()
    if (ORIGINAL === undefined) delete process.env[KEY]
    else process.env[KEY] = ORIGINAL
  })

  it('переменная не задана → используется цена-плейсхолдер (300 для "start")', async () => {
    const { TOKEN_PACKAGES: pkgs } = await import('../src/lib/token-packages')
    expect(pkgs.find((p) => p.id === 'start')?.priceRub).toBe(300)
  })

  it('переменная задана корректно → используется её значение', async () => {
    process.env[KEY] = '450'
    const { TOKEN_PACKAGES: pkgs } = await import('../src/lib/token-packages')
    expect(pkgs.find((p) => p.id === 'start')?.priceRub).toBe(450)
  })

  it('переменная задана некорректно (не число/не положительное) → модуль бросает при загрузке', async () => {
    process.env[KEY] = 'полтинник'
    await expect(import('../src/lib/token-packages')).rejects.toThrow(/TOKEN_PACKAGE_START_RUB/)
  })

  it('переменная задана нулём/отрицательным → тоже бросает', async () => {
    process.env[KEY] = '-5'
    await expect(import('../src/lib/token-packages')).rejects.toThrow(/TOKEN_PACKAGE_START_RUB/)
  })
})
