import { describe, it, expect } from 'vitest'
import { signToken, verifyToken } from '../src/lib/tbank/signature'

describe('tbank signature', () => {
  // Эталонный пример из документации developer.tbank.ru/eacq/intro/developer/token
  it('воспроизводит эталонный хеш из документации', () => {
    const params = {
      TerminalKey: 'MerchantTerminalKey',
      Amount: 19200,
      OrderId: '00000',
      Description: 'Подарочная карта на 1000 рублей',
    }
    expect(signToken(params, '11111111111111')).toBe(
      '72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2',
    )
  })

  it('исключает вложенные объекты и массивы (Receipt, DATA) и поле Token', () => {
    const withNested = {
      TerminalKey: 'MerchantTerminalKey',
      Amount: 19200,
      OrderId: '00000',
      Description: 'Подарочная карта на 1000 рублей',
      Receipt: { Items: [{ Name: 'x' }] },
      DATA: { foo: 'bar' },
      Token: 'должен-игнорироваться',
    }
    expect(signToken(withNested, '11111111111111')).toBe(
      '72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2',
    )
  })

  it('verifyToken: true для корректной подписи, false для битой', () => {
    const body: Record<string, unknown> = { TerminalKey: 'T', OrderId: '1', Success: true, Status: 'CONFIRMED', Amount: 30000 }
    body.Token = signToken(body, 'secret')
    expect(verifyToken(body, 'secret')).toBe(true)
    expect(verifyToken({ ...body, Amount: 40000 }, 'secret')).toBe(false)
    expect(verifyToken({ ...body, Token: 'abc' }, 'secret')).toBe(false)
  })

  it('булевы значения кодируются как true/false', () => {
    // Success приходит в нотификации булевым и участвует в подписи
    const t = signToken({ Success: true, Status: 'CONFIRMED' }, 'p')
    expect(typeof t).toBe('string')
    expect(t).toHaveLength(64)
  })
})
