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
  if (!rl.allowed) {
    // Отвечаем НЕ "OK": для Т-Банка "OK" значит "обработано, не повторять".
    // Источники нотификаций банка — небольшой пул IP, легитимный всплеск может
    // попасть под троттлинг — реальный платёж не должен молча потеряться без ретрая.
    // IP не логируем — это персональные данные (152-ФЗ, правило №11: в логах только
    // размеры/счётчики/коды, без PII).
    logger.error({ event: 'payment.webhook_rate_limited' })
    return new NextResponse('TOO MANY REQUESTS', { status: 429 })
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    logger.error({ event: 'payment.webhook_bad_body', bytes: 0 })
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }

  let body: NotificationBody
  try {
    body = JSON.parse(rawBody) as NotificationBody
  } catch {
    logger.error({ event: 'payment.webhook_bad_body', bytes: rawBody.length })
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }

  const password = process.env.TBANK_PASSWORD || ''
  if (!password) {
    // Fail closed: без пароля подпись Т-Банка (SHA-256 от отсортированных параметров
    // + пароль) была бы тривиально подделываемой пустой строкой — значит нельзя
    // доверять classifyNotification и уж тем более начислять токены. Возвращаем
    // НЕ "OK", чтобы банк повторил нотификацию после того как секрет поправят.
    logger.error({ event: 'payment.webhook_misconfigured' })
    return new NextResponse('SERVER MISCONFIGURED', { status: 500 })
  }

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
    case 'ignore': {
      // amount_mismatch/unknown_order — сигнал мошенничества или рассинхрона с банком,
      // должен быть виден громко. no_order/unhandled_status — обычный шум, info хватает.
      const loud = outcome.reason === 'amount_mismatch' || outcome.reason === 'unknown_order'
      const log = loud ? logger.error : logger.info
      log({ event: 'payment.webhook_ignored', reason: outcome.reason, order_id: String(body.OrderId ?? '') })
      return OK()
    }
    case 'status': {
      let count = 0
      try {
        // updateMany + creditedAt: null — поздняя нотификация (AUTHORIZED/REJECTED),
        // пришедшая после того как платёж уже начислен по CONFIRMED, не должна
        // затирать статус уже начисленного платежа (Т-Банк повторяет нотификации до месяца).
        const result = await prisma.payment.updateMany({
          where: { id: outcome.paymentId, creditedAt: null },
          data: { status: outcome.status },
        })
        count = result.count
      } catch (err) {
        // Не проглатываем: пробрасываем дальше, чтобы ответ ушёл не 200 и банк повторил запрос.
        logger.error({
          event: 'payment.webhook_status_failed',
          payment_id: outcome.paymentId,
          error: String(err),
        })
        throw err
      }
      if (count === 0) {
        logger.info({ event: 'payment.webhook_status_ignored', payment_id: outcome.paymentId, status: outcome.status })
      } else {
        logger.info({ event: 'payment.webhook_status', payment_id: outcome.paymentId, status: outcome.status })
      }
      return OK()
    }
    case 'credit': {
      let res: Awaited<ReturnType<typeof creditForPayment>>
      try {
        res = await creditForPayment(outcome.paymentId)
      } catch (err) {
        logger.error({
          event: 'payment.webhook_credit_failed',
          payment_id: outcome.paymentId,
          error: String(err),
        })
        throw err
      }
      if (res === 'refused') {
        // Банк подтвердил (CONFIRMED), но guard отказал в начислении — платёж терминально
        // отклонён/отменён у нас при пустом creditedAt. Это не безобидный повтор, а потеря
        // реального платежа. Ретрай не поможет (см. creditForPayment), поэтому громко логируем,
        // но всё равно отвечаем OK — чтобы банк не долбил повторами то, что не исправится само.
        logger.error({ event: 'payment.webhook_credit_refused', payment_id: outcome.paymentId })
      } else {
        logger.info({ event: 'payment.webhook_credit', payment_id: outcome.paymentId, result: res })
      }
      return OK()
    }
  }
}
