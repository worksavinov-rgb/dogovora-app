import { NextRequest } from 'next/server'
import { verifyToken, getTokenFromCookie } from '@/lib/auth'
import { isTokenRevoked } from '@/lib/token-store'

/**
 * Достаёт userId из access_token cookie. Возвращает null, если токена нет,
 * он невалидный или был отозван (логаут/ротация).
 */
export async function getUserId(req: NextRequest): Promise<string | null> {
  const cookieHeader = req.headers.get('cookie')
  const token = getTokenFromCookie(cookieHeader, 'access_token')
  if (!token) return null
  try {
    const payload = verifyToken(token)
    // Отозванные токены (после логаута) считаем невалидными.
    if (payload.jti && (await isTokenRevoked(payload.jti))) return null
    return payload.userId
  } catch {
    return null
  }
}
