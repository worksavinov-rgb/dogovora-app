import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { comparePassword, signAccessToken, signRefreshToken } from '@/lib/auth'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { checkLoginLock, recordLoginFailure, resetLoginFailures } from '@/lib/login-attempts'
import { recordLoginAudit } from '@/lib/login-audit'

const LoginSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(1, 'Введите пароль'),
})

export async function POST(req: Request) {
  try {
    // Защита от брутфорса: не более 10 попыток с одного IP за 5 минут.
    const ip = getClientIp(req)
    const rl = await rateLimit(`login:${ip}`, 10, 5 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Слишком много попыток входа. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const userAgent = req.headers.get('user-agent')

    const body = await req.json() as unknown
    const data = LoginSchema.parse(body)
    const email = data.email.trim().toLowerCase()

    // Блокировка по аккаунту: защита от подбора пароля с разных IP (ботнет).
    const lock = await checkLoginLock(email)
    if (lock.locked) {
      await recordLoginAudit({ email, ip, userAgent, result: 'LOCKED' })
      return NextResponse.json(
        { error: 'Аккаунт временно заблокирован из-за множества неудачных попыток. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } },
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    })

    if (!user) {
      // Считаем неудачу по email даже для несуществующего аккаунта — чтобы не
      // раскрывать существование email и не давать перебор через эту разницу.
      await recordLoginFailure(email)
      await recordLoginAudit({ email, ip, userAgent, result: 'FAIL' })
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    const valid = await comparePassword(data.password, user.passwordHash)
    if (!valid) {
      await recordLoginFailure(email)
      await recordLoginAudit({ email, userId: user.id, ip, userAgent, result: 'FAIL' })
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    // Успешный вход — сбрасываем счётчик неудач.
    await resetLoginFailures(email)
    await recordLoginAudit({ email, userId: user.id, ip, userAgent, result: 'SUCCESS' })

    const payload = { userId: user.id, email: user.email }
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    const { passwordHash: _ph, ...safeUser } = user
    const res = NextResponse.json({ user: safeUser })

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
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
