import { describe, it, expect } from 'vitest'
import { buildReceipt } from '../src/lib/tbank/receipt'

describe('buildReceipt', () => {
  it('одна позиция, сумма и цена совпадают с amountKopecks', () => {
    const r = buildReceipt({ email: 'user@example.com', label: 'Пакет Старт', amountKopecks: 30000 }) as any
    expect(r.Email).toBe('user@example.com')
    expect(r.Items).toHaveLength(1)
    expect(r.Items[0].Price).toBe(30000)
    expect(r.Items[0].Amount).toBe(30000)
    expect(r.Items[0].Quantity).toBe(1)
    expect(r.Items[0].Name).toContain('Старт')
  })

  it('СНО и НДС берутся из ENV, по умолчанию usn_income / none', () => {
    const r = buildReceipt({ email: 'a@b.c', label: 'x', amountKopecks: 100 }) as any
    expect(r.Taxation).toBe('usn_income')
    expect(r.Items[0].Tax).toBe('none')
  })
})
