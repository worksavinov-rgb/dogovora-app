import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { classifyNotification, creditForPayment } = vi.hoisted(() => ({
  classifyNotification: vi.fn(),
  creditForPayment: vi.fn(),
}))
const { rateLimit } = vi.hoisted(() => ({ rateLimit: vi.fn() }))
const { prismaPaymentUpdateMany } = vi.hoisted(() => ({ prismaPaymentUpdateMany: vi.fn() }))
const { loggerInfo, loggerError } = vi.hoisted(() => ({ loggerInfo: vi.fn(), loggerError: vi.fn() }))

vi.mock('@/lib/payments', () => ({
  classifyNotification,
  creditForPayment,
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit,
  getClientIp: () => '203.0.113.1',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    payment: {
      findUnique: vi.fn(async () => null),
      updateMany: prismaPaymentUpdateMany,
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: loggerInfo, error: loggerError },
}))

import { POST } from '../src/app/api/payments/webhook/route'

function makeReq(body: unknown, raw?: string) {
  return new NextRequest('http://localhost/api/payments/webhook', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
  })
}

describe('POST /api/payments/webhook', () => {
  const ORIGINAL_PASSWORD = process.env.TBANK_PASSWORD

  beforeEach(() => {
    vi.clearAllMocks()
    rateLimit.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSec: 0 })
    process.env.TBANK_PASSWORD = 'secret'
  })

  afterEach(() => {
    if (ORIGINAL_PASSWORD === undefined) delete process.env.TBANK_PASSWORD
    else process.env.TBANK_PASSWORD = ORIGINAL_PASSWORD
  })

  it('успешное начисление (credit) → 200 и тело ровно "OK"', async () => {
    classifyNotification.mockResolvedValue({ action: 'credit', paymentId: 'p1' })
    creditForPayment.mockResolvedValue('credited')

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(creditForPayment).toHaveBeenCalledWith('p1')
  })

  it('битая подпись (reject) → 403, тело не "OK", начисления не было', async () => {
    classifyNotification.mockResolvedValue({ action: 'reject', reason: 'bad_signature' })

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'bad' }))

    expect(res.status).toBe(403)
    expect(await res.text()).not.toBe('OK')
    expect(creditForPayment).not.toHaveBeenCalled()
  })

  it('ignore unknown_order → 200/"OK", но лог громкий (error): признак рассинхрона с банком', async () => {
    classifyNotification.mockResolvedValue({ action: 'ignore', reason: 'unknown_order' })

    const res = await POST(makeReq({ OrderId: 'нет', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(creditForPayment).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_ignored', reason: 'unknown_order' }),
    )
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'payment.webhook_ignored' }))
  })

  it('ignore amount_mismatch → 200/"OK", но лог громкий (error): признак мошенничества', async () => {
    classifyNotification.mockResolvedValue({ action: 'ignore', reason: 'amount_mismatch' })

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 1, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_ignored', reason: 'amount_mismatch' }),
    )
  })

  it('ignore no_order → 200/"OK", лог тихий (info): обычный шум, не сигнал угрозы', async () => {
    classifyNotification.mockResolvedValue({ action: 'ignore', reason: 'no_order' })

    const res = await POST(makeReq({ Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_ignored', reason: 'no_order' }),
    )
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('ignore unhandled_status → 200/"OK", лог тихий (info)', async () => {
    classifyNotification.mockResolvedValue({ action: 'ignore', reason: 'unhandled_status' })

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'REFUNDED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_ignored', reason: 'unhandled_status' }),
    )
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('нет TBANK_PASSWORD → 500, тело не "OK", classifyNotification не вызывается, начисления не было', async () => {
    delete process.env.TBANK_PASSWORD

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(500)
    expect(await res.text()).not.toBe('OK')
    expect(classifyNotification).not.toHaveBeenCalled()
    expect(creditForPayment).not.toHaveBeenCalled()
  })

  it('троттлинг → 429, тело не "OK", начисления не было', async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 30 })

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(429)
    expect(await res.text()).not.toBe('OK')
    expect(classifyNotification).not.toHaveBeenCalled()
    expect(creditForPayment).not.toHaveBeenCalled()
  })

  it('битое тело запроса (невалидный JSON) → 400', async () => {
    const res = await POST(makeReq(undefined, '{ не json'))

    expect(res.status).toBe(400)
    expect(classifyNotification).not.toHaveBeenCalled()
    expect(creditForPayment).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment.webhook_bad_body' }))
  })

  it('status → prisma.payment.updateMany вызван с where creditedAt:null, 200 и тело ровно "OK"', async () => {
    classifyNotification.mockResolvedValue({ action: 'status', paymentId: 'p1', status: 'REJECTED' })
    prismaPaymentUpdateMany.mockResolvedValue({ count: 1 })

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'REJECTED', Amount: 30000, Token: 'x' }))

    expect(prismaPaymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', creditedAt: null },
      data: { status: 'REJECTED' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_status', payment_id: 'p1', status: 'REJECTED' }),
    )
  })

  it('status на уже начисленном платеже (count=0) → 200/"OK", статус НЕ переписывается, лог info о игноре', async () => {
    classifyNotification.mockResolvedValue({ action: 'status', paymentId: 'p1', status: 'AUTHORIZED' })
    prismaPaymentUpdateMany.mockResolvedValue({ count: 0 })

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'AUTHORIZED', Amount: 30000, Token: 'x' }))

    expect(prismaPaymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', creditedAt: null },
      data: { status: 'AUTHORIZED' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_status_ignored', payment_id: 'p1', status: 'AUTHORIZED' }),
    )
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('status с падением prisma.payment.updateMany → ошибка пробрасывается, не 200/"OK", logger.error вызван', async () => {
    classifyNotification.mockResolvedValue({ action: 'status', paymentId: 'p1', status: 'REJECTED' })
    prismaPaymentUpdateMany.mockRejectedValue(new Error('db down'))

    await expect(POST(makeReq({ OrderId: 'ord-1', Status: 'REJECTED', Amount: 30000, Token: 'x' }))).rejects.toThrow(
      'db down'
    )
    expect(loggerError).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment.webhook_status_failed' }))
  })

  it('credit с падением creditForPayment → ошибка пробрасывается, не 200/"OK", logger.error вызван', async () => {
    classifyNotification.mockResolvedValue({ action: 'credit', paymentId: 'p1' })
    creditForPayment.mockRejectedValue(new Error('credit failed'))

    await expect(POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))).rejects.toThrow(
      'credit failed'
    )
    expect(loggerError).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment.webhook_credit_failed' }))
  })

  it('credit → "refused" → 200/"OK" (банк не должен долбить ретраями), но лог громкий (error)', async () => {
    classifyNotification.mockResolvedValue({ action: 'credit', paymentId: 'p1' })
    creditForPayment.mockResolvedValue('refused')

    const res = await POST(makeReq({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.webhook_credit_refused', payment_id: 'p1' }),
    )
    expect(loggerInfo).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'payment.webhook_credit' }))
  })
})
