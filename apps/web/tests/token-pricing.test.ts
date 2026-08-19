import { describe, it, expect } from 'vitest'
import { TOKEN_PRICES, EDITS_PER_PACKAGE, WELCOME_BONUS_TOKENS, calcEditLimit, formatTokens } from '../src/lib/token-pricing'

describe('token-pricing', () => {
  it('цены по умолчанию', () => {
    expect(TOKEN_PRICES.generate).toBe(100)
    expect(TOKEN_PRICES.uploadEditStart).toBe(50)
    expect(TOKEN_PRICES.rewrite).toBe(100)
    expect(TOKEN_PRICES.editPackage).toBe(100)
    expect(TOKEN_PRICES.review).toBe(25)
    expect(TOKEN_PRICES.analyzeUpload).toBe(25)
    expect(EDITS_PER_PACKAGE).toBe(10)
    expect(WELCOME_BONUS_TOKENS).toBe(500)
  })

  it('лимит правок: пакеты × 10', () => {
    expect(calcEditLimit(2, false, true)).toBe(20)
    expect(calcEditLimit(1, true, true)).toBe(10)
  })

  it('лимит правок: до-токеновый документ (нет истории списаний) получает 1 неявный пакет', () => {
    // 0 пакетов, НЕ загружен, истории списаний нет → неявный бесплатный пакет
    expect(calcEditLimit(0, false, false)).toBe(10)
    // 0 пакетов, загруженный → правок нет, пока не оплачен старт правок
    expect(calcEditLimit(0, true, false)).toBe(0)
  })

  it('лимит правок: возврат упавшей генерации НЕ даёт бесплатный пакет', () => {
    // 0 активных пакетов, но история списаний была (генерация возвращена) → 0 правок
    expect(calcEditLimit(0, false, true)).toBe(0)
  })

  it('formatTokens склоняет', () => {
    expect(formatTokens(1)).toBe('1 токен')
    expect(formatTokens(2)).toBe('2 токена')
    expect(formatTokens(100)).toBe('100 токенов')
    expect(formatTokens(21)).toBe('21 токен')
    expect(formatTokens(11)).toBe('11 токенов')
    expect(formatTokens(114)).toBe('114 токенов')
  })
})
