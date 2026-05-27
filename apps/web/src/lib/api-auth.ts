import { NextRequest } from 'next/server'
import { verifyToken, getTokenFromCookie } from '@/lib/auth'

/** Достаёт userId из access_token cookie. Возвращает null если токена нет или он невалидный. */
export function getUserId(req: NextRequest): string | null {
  const cookieHeader = req.headers.get('cookie')
  const token = getTokenFromCookie(cookieHeader, 'access_token')
  if (!token) return null
  try {
    return verifyToken(token).userId
  } catch {
    return null
  }
}
