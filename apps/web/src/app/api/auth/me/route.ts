import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyToken, getTokenFromCookie } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const token = getTokenFromCookie(req.headers.get('cookie'), 'access_token')
    if (!token) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const payload = verifyToken(token)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        wallet: { select: { balance: true } },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }
}
