import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  verifyToken,
  getTokenFromCookie,
  getRevocationInfo,
  signAccessToken,
  signRefreshToken,
} from '@/lib/auth'
import { isTokenRevoked, revokeToken } from '@/lib/token-store'

// POST /api/auth/refresh — обновить access-токен по refresh-токену с РОТАЦИЕЙ.
// Старый refresh-токен отзывается, выдаётся новая пара. Это ограничивает
// последствия кражи refresh-токена: повторное использование старого невозможно.
export async function POST(req: NextRequest) {
  const refreshToken = getTokenFromCookie(req.headers.get('cookie'), 'refresh_token')
  if (!refreshToken) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }

  let payload
  try {
    payload = verifyToken(refreshToken)
  } catch {
    return NextResponse.json({ error: 'Сессия истекла' }, { status: 401 })
  }

  // Отозванный (использованный/после логаута) refresh-токен повторно не принимаем.
  if (payload.jti && (await isTokenRevoked(payload.jti))) {
    return NextResponse.json({ error: 'Сессия недействительна' }, { status: 401 })
  }

  // Пользователь всё ещё существует?
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'Пользователь не найден' }, { status: 401 })
  }

  // Ротация: отзываем предъявленный refresh-токен.
  const info = getRevocationInfo(refreshToken)
  if (info && info.ttlSec > 0) {
    await revokeToken(info.jti, info.ttlSec)
  }

  const newPayload = { userId: user.id, email: user.email }
  const accessToken = signAccessToken(newPayload)
  const newRefreshToken = signRefreshToken(newPayload)

  const res = NextResponse.json({ ok: true })

  const secureCookie = process.env['COOKIE_SECURE'] !== 'false' && process.env['NODE_ENV'] === 'production'
  res.cookies.set('access_token', accessToken, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    maxAge: 15 * 60,
    path: '/',
  })
  res.cookies.set('refresh_token', newRefreshToken, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  })

  return res
}
