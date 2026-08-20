import { prisma } from './db'

/**
 * Идемпотентно начисляет токены за подтверждённый платёж.
 * Guard: updateMany where creditedAt IS NULL — ровно одна транзакция «выигрывает»
 * право начислить; повторные вебхуки видят count=0 и выходят. Инкремент баланса
 * атомарен на уровне SQL, отдельный FOR UPDATE не нужен.
 */
export async function creditForPayment(
  paymentId: string,
  db: typeof prisma = prisma,
): Promise<'credited' | 'already'> {
  return db.$transaction(async (tx) => {
    const marked = await tx.payment.updateMany({
      where: { id: paymentId, creditedAt: null },
      data: { creditedAt: new Date(), status: 'CONFIRMED' },
    })
    if (marked.count === 0) return 'already'

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
