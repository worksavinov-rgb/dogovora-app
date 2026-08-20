import { describe, it, expect, vi } from 'vitest'
import { creditForPayment } from '../src/lib/payments'

function makeFakeDb(payment: { id: string; userId: string; tokens: number; status?: string }) {
  let creditedAt: Date | null = null
  let status = payment.status ?? 'NEW'
  const tx = {
    payment: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (creditedAt) return { count: 0 }
        if (where.status && !where.status.in.includes(status)) return { count: 0 }
        creditedAt = data.creditedAt
        status = data.status
        return { count: 1 }
      }),
      findUnique: vi.fn(async () => ({ ...payment, creditedAt, status })),
      update: vi.fn(async () => ({})),
    },
    wallet: {
      upsert: vi.fn(async () => ({ id: 'w1' })),
      update: vi.fn(async () => ({})),
    },
    transaction: { create: vi.fn(async () => ({ id: 't1' })) },
  }
  const db = { $transaction: async (fn: any) => fn(tx) } as any
  return { db, tx }
}

describe('creditForPayment', () => {
  it('первое начисление увеличивает баланс и пишет CREDIT-транзакцию', async () => {
    const { db, tx } = makeFakeDb({ id: 'p1', userId: 'u1', tokens: 1000 })
    const r = await creditForPayment('p1', db)
    expect(r).toBe('credited')
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p1', creditedAt: null }),
      }),
    )
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { increment: 1000 } } }),
    )
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CREDIT', currency: 'TOKEN', amount: 1000 }) }),
    )
  })

  it('повторный вебхук не начисляет второй раз', async () => {
    const { db, tx } = makeFakeDb({ id: 'p1', userId: 'u1', tokens: 1000 })
    await creditForPayment('p1', db)
    tx.wallet.update.mockClear()
    tx.transaction.create.mockClear()
    const r = await creditForPayment('p1', db)
    expect(r).toBe('already')
    expect(tx.wallet.update).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })

  it('терминально отклонённый платёж не начисляется, даже если creditedAt пуст', async () => {
    const { db, tx } = makeFakeDb({ id: 'p2', userId: 'u1', tokens: 1000, status: 'REJECTED' })
    const r = await creditForPayment('p2', db)
    expect(r).toBe('already')
    expect(tx.wallet.update).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })
})
