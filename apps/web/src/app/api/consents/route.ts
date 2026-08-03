import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/lib/api-auth'
import { getClientIp } from '@/lib/rate-limit'
import { getConsentState, recordConsent } from '@/lib/consent'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

/**
 * Согласия пользователя (152-ФЗ).
 *
 * GET  — текущее состояние согласий.
 * POST — принять обязательные согласия (для аккаунтов, созданных до их введения,
 *        и при выходе новой редакции документов) либо изменить решение по рассылке.
 *
 * Обязательные согласия через этот эндпоинт отозвать нельзя: отзыв означает
 * прекращение договора и обрабатывается по обращению на почту оператора —
 * так требует ч. 2 ст. 9 152-ФЗ (отзыв в той же форме, с идентификацией заявителя).
 */

const AcceptSchema = z.object({
  consentOffer: z.literal(true, 'Примите оферту и пользовательское соглашение'),
  consentPdn: z.literal(true, 'Примите согласие на обработку персональных данных'),
  consentCrossBorder: z.literal(true, 'Примите согласие на трансграничную передачу данных'),
  consentMarketing: z.boolean().optional().default(false),
})

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  return NextResponse.json({ consents: await getConsentState(userId) })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  try {
    const data = AcceptSchema.parse(await req.json())
    const ctx = {
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
      source: 'settings',
    }

    await recordConsent(userId, 'OFFER', true, ctx)
    await recordConsent(userId, 'PDN', true, ctx)
    await recordConsent(userId, 'CROSS_BORDER', true, ctx)
    await recordConsent(userId, 'MARKETING', data.consentMarketing, ctx)

    return NextResponse.json({ consents: await getConsentState(userId) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      const firstIssue = err.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? 'Ошибка валидации' }, { status: 400 })
    }
    logger.error({
      event: 'consent.accept_error',
      error: err,
      request_id: getRequestId(req),
    })
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
