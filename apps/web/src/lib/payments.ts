import { prisma } from './db'
import { verifyToken } from '@/lib/tbank/signature'
import type { PaymentStatus } from '@prisma/client'

/**
 * Идемпотентно начисляет токены за подтверждённый платёж.
 * Guard: updateMany where creditedAt IS NULL — ровно одна транзакция «выигрывает»
 * право начислить; повторные вебхуки видят count=0 и выходят. Инкремент баланса
 * атомарен на уровне SQL, отдельный FOR UPDATE не нужен.
 * Дополнительно guard ограничен status IN (NEW, AUTHORIZED): платёж в терминальном
 * статусе (REJECTED/CANCELED/REFUNDED) с пустым creditedAt никогда не будет начислен —
 * такой случай возвращает 'refused' (не 'already'), чтобы вызывающий код мог отличить
 * настоящий повтор уже начисленного платежа от отказа начислить реально подтверждённый.
 */
export async function creditForPayment(
  paymentId: string,
  db: typeof prisma = prisma,
): Promise<'credited' | 'already' | 'refused'> {
  return db.$transaction(async (tx) => {
    const marked = await tx.payment.updateMany({
      where: { id: paymentId, creditedAt: null, status: { in: ['NEW', 'AUTHORIZED'] } },
      data: { creditedAt: new Date(), status: 'CONFIRMED' },
    })
    if (marked.count === 0) {
      const existing = await tx.payment.findUnique({ where: { id: paymentId }, select: { creditedAt: true } })
      return existing && existing.creditedAt === null ? 'refused' : 'already'
    }

    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment) return 'already'

    const wallet = await tx.wallet.upsert({
      where: { userId: payment.userId },
      create: { userId: payment.userId, balance: 0 },
      update: {},
    })
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: payment.tokens } },
    })
    const trx = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount: payment.tokens,
        currency: 'TOKEN',
        description: `Пополнение баланса: ${payment.tokens} токенов`,
      },
    })
    await tx.payment.update({
      where: { id: paymentId },
      data: { creditTransactionId: trx.id },
    })
    return 'credited'
  })
}

export interface NotificationBody {
  OrderId?: string
  Status?: string
  Amount?: number
  Token?: string
  [k: string]: unknown
}

export type NotificationOutcome =
  | { action: 'reject'; reason: string }
  | { action: 'ignore'; reason: string }
  | { action: 'credit'; paymentId: string }
  | { action: 'status'; paymentId: string; status: PaymentStatus }

/**
 * Чистая классификация вебхука: подпись → заказ → сумма → статус.
 * Токены/сумму берём из нашей записи (deps.loadPayment), не из тела.
 */
export async function classifyNotification(
  body: NotificationBody,
  deps: { password: string; loadPayment: (orderId: string) => Promise<{ id: string; amount: number } | null> },
): Promise<NotificationOutcome> {
  if (!verifyToken(body, deps.password)) return { action: 'reject', reason: 'bad_signature' }

  const orderId = String(body.OrderId ?? '')
  if (!orderId) return { action: 'ignore', reason: 'no_order' }

  const payment = await deps.loadPayment(orderId)
  if (!payment) return { action: 'ignore', reason: 'unknown_order' }

  if (Number(body.Amount) !== payment.amount) return { action: 'ignore', reason: 'amount_mismatch' }

  const status = String(body.Status ?? '')
  if (status === 'CONFIRMED') return { action: 'credit', paymentId: payment.id }
  if (status === 'REJECTED') return { action: 'status', paymentId: payment.id, status: 'REJECTED' }
  if (status === 'CANCELED') return { action: 'status', paymentId: payment.id, status: 'CANCELED' }
  if (status === 'AUTHORIZED') return { action: 'status', paymentId: payment.id, status: 'AUTHORIZED' }
  return { action: 'ignore', reason: 'unhandled_status' }
}
