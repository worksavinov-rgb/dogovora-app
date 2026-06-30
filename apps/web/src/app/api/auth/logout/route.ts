import { NextRequest, NextResponse } from 'next/server'
import { getTokenFromCookie, getRevocationInfo, verifyToken } from '@/lib/auth'
import { revokeToken } from '@/lib/token-store'
import { recordLoginAudit } from '@/lib/login-audit'
import { getClientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie')

  // Записываем событие выхода (если токен ещё читается).
  const accessToken = getTokenFromCookie(cookieHeader, 'access_token')
  if (accessToken) {
    try {
      const p = verifyToken(accessToken)
      await recordLoginAudit({
        email: p.email,
        userId: p.userId,
        ip: getClientIp(req),
        userAgent: req.headers.get('user-agent'),
        result: 'LOGOUT',
      })
    } catch {
      // токен невалиден/истёк — просто чистим cookie ниже
    }
  }

  // Отзываем оба токена: заносим их jti в blocklist до естественного истечения,
  // чтобы украденный/перехваченный токен больше не работал даже до конца срока.
  for (const name of ['access_token', 'refresh_token']) {
    const token = getTokenFromCookie(cookieHeader, name)
    if (!token) continue
    const info = getRevocationInfo(token)
    if (info && info.ttlSec > 0) {
      await revokeToken(info.jti, info.ttlSec)
    }
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.delete('access_token')
  res.cookies.delete('refresh_token')
  return res
}
