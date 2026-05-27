import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { hashPassword, signAccessToken, signRefreshToken } from '@/lib/auth'

const RegisterSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Пароль — минимум 8 символов'),
  name: z.string().min(1, 'Укажите имя').optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json() as unknown
    const data = RegisterSchema.parse(body)

    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(data.password)

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        wallet: { create: { balance: 0 } },
        storageQuota: { create: { usedBytes: 0, limitBytes: 524288000 } }, // 500 MB
      },
      select: { id: true, email: true, createdAt: true },
    })

    const payload = { userId: user.id, email: user.email }
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    const res = NextResponse.json({ user }, { status: 201 })

    res.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 мин
      path: '/',
    })
    res.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 дней
      path: '/',
    })

    return res
  } catch (err) {
    if (err instanceof z.ZodError) {
      const firstIssue = err.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? 'Ошибка валидации' }, { status: 400 })
    }
    console.error('Register error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
