import { describe, it, expect } from 'vitest'
import { classifyNotification } from '../src/lib/payments'
import { signToken } from '../src/lib/tbank/signature'

const PW = 'secret'
function signed(body: Record<string, unknown>) {
  return { ...body, Token: signToken(body, PW) }
}
const loadPayment = async (orderId: string) =>
  orderId === 'ord-1' ? { id: 'p1', amount: 30000 } : null

describe('classifyNotification', () => {
  it('битая подпись → reject', async () => {
    const out = await classifyNotification(
      { OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'плохой' },
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'reject', reason: 'bad_signature' })
  })

  it('неизвестный заказ → ignore', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'нет', Status: 'CONFIRMED', Amount: 30000 }),
      { password: PW, loadPayment },
    )
    expect(out.action).toBe('ignore')
  })

  it('несовпадение суммы → ignore', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 99999 }),
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'ignore', reason: 'amount_mismatch' })
  })

  it('CONFIRMED с верной суммой → credit', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000 }),
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'credit', paymentId: 'p1' })
  })

  it('REJECTED → status REJECTED', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'ord-1', Status: 'REJECTED', Amount: 30000 }),
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'status', paymentId: 'p1', status: 'REJECTED' })
  })
})
