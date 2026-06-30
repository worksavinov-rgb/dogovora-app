import { NextRequest, NextResponse } from 'next/server'
import { getTokenFromCookie, getRevocationInfo } from '@/lib/auth'
import { revokeToken } from '@/lib/token-store'

export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie')

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
