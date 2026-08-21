import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getUserId } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getPackage, priceKopecks } from '@/lib/token-packages'
import { buildReceipt } from '@/lib/tbank/receipt'
import { initPayment } from '@/lib/tbank/client'

// POST /api/payments/create — создаёт платёж и возвращает ссылку на оплату.
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`pay-create:${userId}`, 10, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Слишком часто, попробуйте позже.' }, { status: 429 })

  let packageId = ''
  try {
    packageId = String((await req.json())?.packageId ?? '')
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const pkg = getPackage(packageId)
  if (!pkg) return NextResponse.json({ error: 'Неизвестный пакет' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderId = `pay_${randomUUID()}`
  const amount = priceKopecks(pkg)

  const payment = await prisma.payment.create({
    data: { userId, orderId, packageId: pkg.id, tokens: pkg.tokens, amount, status: 'NEW' },
  })

  try {
    const init = await initPayment({
      orderId,
      amountKopecks: amount,
      description: `Пополнение баланса — ${pkg.label}`,
      receipt: buildReceipt({ email: user.email, label: pkg.label, amountKopecks: amount }),
    })
    await prisma.payment.update({ where: { id: payment.id }, data: { bankPaymentId: init.paymentId } })
    logger.info({ event: 'payment.created', user_id: userId, order_id: orderId, amount, tokens: pkg.tokens })
    return NextResponse.json({ paymentUrl: init.paymentUrl, paymentId: payment.id })
  } catch (e) {
    logger.error({ event: 'payment.init_failed', user_id: userId, order_id: orderId, error: String(e) })
    // Init не прошёл — банк платёж не зарегистрировал, значит и у нас он не должен
    // висеть «живым»: помечаем отменённым, чтобы не остался мёртвой строкой без вебхука.
    try {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELED', errorCode: 'INIT_FAILED' },
      })
    } catch (updateError) {
      logger.error({ event: 'payment.cancel_failed', user_id: userId, order_id: orderId, error: String(updateError) })
    }
    return NextResponse.json({ error: 'Не удалось создать платёж. Попробуйте позже.' }, { status: 502 })
  }
}
