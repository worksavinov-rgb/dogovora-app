import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { hashPassword, signAccessToken, signRefreshToken } from '@/lib/auth'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { recordLoginAudit } from '@/lib/login-audit'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

const RegisterSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Пароль — минимум 8 символов'),
  fullName: z.string().min(2, 'Укажите ФИО'),
  businessScope: z.string().min(2, 'Укажите сферу деятельности'),
  promoCode: z.string().min(1, 'Введите промокод'),
})

const WELCOME_BONUS = 5000

export async function POST(req: Request) {
  try {
    // Защита от перебора промокодов: не более 10 регистраций с одного IP за час.
    const ip = getClientIp(req)
    const rl = await rateLimit(`register:${ip}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Слишком много попыток регистрации. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const body = await req.json() as unknown
    const data = RegisterSchema.parse(body)
    const email = data.email.trim().toLowerCase()

    // Проверяем промокод
    const promo = await prisma.promoCode.findUnique({
      where: { code: data.promoCode.trim().toUpperCase() },
    })

    if (!promo) {
      return NextResponse.json({ error: 'Промокод не найден' }, { status: 400 })
    }
    if (!promo.isActive) {
      return NextResponse.json({ error: 'Промокод недействителен' }, { status: 400 })
    }
    if (promo.usedById) {
      return NextResponse.json({ error: 'Промокод уже использован' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(data.password)

    // Создаём пользователя + кошелёк с бонусом + транзакцию + помечаем промокод — всё атомарно
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: data.fullName,
          businessScope: data.businessScope,
          storageQuota: { create: { usedBytes: 0, limitBytes: 524288000 } },
        },
        select: { id: true, email: true, createdAt: true },
      })

      const wallet = await tx.wallet.create({
        data: {
          userId: newUser.id,
          balance: WELCOME_BONUS,
        },
      })

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amount: WELCOME_BONUS,
          description: 'Приветственный бонус за регистрацию',
        },
      })

      await tx.promoCode.update({
        where: { id: promo.id },
        data: {
          usedById: newUser.id,
          usedAt: new Date(),
        },
      })

      return newUser
    })

    await recordLoginAudit({
      email: user.email,
      userId: user.id,
      ip,
      userAgent: req.headers.get('user-agent'),
      result: 'SUCCESS',
    })

    const payload = { userId: user.id, email: user.email }
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    const res = NextResponse.json({ user }, { status: 201 })

    const secureCookie = process.env['COOKIE_SECURE'] !== 'false' && process.env['NODE_ENV'] === 'production'
    res.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: 15 * 60,
      path: '/',
    })
    res.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    return res
  } catch (err) {
    if (err instanceof z.ZodError) {
      const firstIssue = err.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? 'Ошибка валидации' }, { status: 400 })
    }
    logger.error({
      event: 'auth.register_error',
      error: err,
      request_id: getRequestId(req),
    })
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
