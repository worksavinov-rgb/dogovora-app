import { describe, it, expect, beforeEach } from 'vitest'
import { initPayment } from '../src/lib/tbank/client'

describe('initPayment', () => {
  beforeEach(() => {
    process.env.TBANK_TERMINAL_KEY = 'TestTerminal'
    process.env.TBANK_PASSWORD = 'secret'
    process.env.TBANK_API_URL = 'https://api.test/v2/'
    process.env.PUBLIC_BASE_URL = 'https://app.test'
  })

  it('шлёт подписанный Init и возвращает paymentId/paymentUrl', async () => {
    let captured: any = null
    const fakeFetch = (async (url: string, opts: any) => {
      captured = { url, body: JSON.parse(opts.body) }
      return { ok: true, json: async () => ({ Success: true, PaymentId: '123', PaymentURL: 'https://pay/123' }) }
    }) as unknown as typeof fetch

    const res = await initPayment(
      { orderId: 'ord-1', amountKopecks: 30000, description: 'Пополнение', receipt: { Email: 'a@b.c' } },
      fakeFetch,
    )
    expect(res).toEqual({ paymentId: '123', paymentUrl: 'https://pay/123' })
    expect(captured.url).toBe('https://api.test/v2/Init')
    expect(captured.body.TerminalKey).toBe('TestTerminal')
    expect(captured.body.Amount).toBe(30000)
    expect(captured.body.OrderId).toBe('ord-1')
    expect(captured.body.PayType).toBe('O')
    expect(captured.body.NotificationURL).toBe('https://app.test/api/payments/webhook')
    expect(typeof captured.body.Token).toBe('string')
    // Receipt присутствует, но в подпись не входит — проверяется в signature-тестах
    expect(captured.body.Receipt).toBeTruthy()
  })

  it('бросает ошибку, если банк вернул Success=false', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => ({ Success: false, ErrorCode: '9999', Message: 'Отказ' }),
    })) as unknown as typeof fetch
    await expect(
      initPayment({ orderId: 'o', amountKopecks: 1000, description: 'd', receipt: {} }, fakeFetch),
    ).rejects.toThrow(/9999|Отказ|Init/)
  })
})
