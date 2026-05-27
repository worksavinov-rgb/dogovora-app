import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { comparePassword, signAccessToken, signRefreshToken } from '@/lib/auth'

const LoginSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(1, 'Введите пароль'),
})

export async function POST(req: Request) {
  try {
    const body = await req.json() as unknown
    const data = LoginSchema.parse(body)

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    const valid = await comparePassword(data.password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    const payload = { userId: user.id, email: user.email }
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    const { passwordHash: _ph, ...safeUser } = user
    const res = NextResponse.json({ user: safeUser })

    res.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60,
      path: '/',
    })
    res.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
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
