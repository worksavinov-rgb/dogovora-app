import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { classifyNotification, creditForPayment, type NotificationBody } from '@/lib/payments'

const OK = () => new NextResponse('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })

// POST /api/payments/webhook — нотификация Т-Банка о статусе платежа.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = await rateLimit(`pay-webhook:${ip}`, 120, 60_000)
  if (!rl.allowed) return new NextResponse('OK', { status: 200 })

  let body: NotificationBody
  try {
    body = (await req.json()) as NotificationBody
  } catch {
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }

  const password = process.env.TBANK_PASSWORD || ''
  const outcome = await classifyNotification(body, {
    password,
    loadPayment: async (orderId) => {
      const p = await prisma.payment.findUnique({ where: { orderId }, select: { id: true, amount: true } })
      return p ? { id: p.id, amount: p.amount } : null
    },
  })

  switch (outcome.action) {
    case 'reject':
      logger.error({ event: 'payment.webhook_bad_signature', order_id: String(body.OrderId ?? '') })
      return new NextResponse('FORBIDDEN', { status: 403 })
    case 'ignore':
      logger.info({ event: 'payment.webhook_ignored', reason: outcome.reason, order_id: String(body.OrderId ?? '') })
      return OK()
    case 'status':
      await prisma.payment.update({ where: { id: outcome.paymentId }, data: { status: outcome.status } })
      logger.info({ event: 'payment.webhook_status', payment_id: outcome.paymentId, status: outcome.status })
      return OK()
    case 'credit': {
      const res = await creditForPayment(outcome.paymentId)
      logger.info({ event: 'payment.webhook_credit', payment_id: outcome.paymentId, result: res })
      return OK()
    }
  }
}
