import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { classifyNotification, creditForPayment } = vi.hoisted(() => ({
  classifyNotification: vi.fn(),
  creditForPayment: vi.fn(),
}))
const { rateLimit } = vi.hoisted(() => ({ rateLimit: vi.fn() }))
const { prismaPaymentUpdate } = vi.hoisted(() => ({ prismaPaymentUpdate: vi.fn() }))
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
      update: prismaPaymentUpdate,
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

  it('ignore → 200, тело "OK", начисления не было', async () => {
    classifyNotification.mockResolvedValue({ action: 'ignore', reason: 'unknown_order' })

    const res = await POST(makeReq({ OrderId: 'нет', Status: 'CONFIRMED', Amount: 30000, Token: 'x' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
    expect(creditForPayment).not.toHaveBeenCalled()
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
  })
})
