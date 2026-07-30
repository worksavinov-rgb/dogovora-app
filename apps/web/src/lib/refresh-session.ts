import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import {
  verifyToken,
  getTokenFromCookie,
  getRevocationInfo,
  signAccessToken,
  signRefreshToken,
} from '@/lib/auth'
import { isTokenRevoked, revokeToken } from '@/lib/token-store'

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; status: number; error: string }

/**
 * Обновляет сессию по refresh-токену с РОТАЦИЕЙ (старый токен отзывается).
 * Возвращает новую пару токенов либо ошибку. Куки НЕ ставит — это делает
 * вызывающий обработчик (POST → JSON, GET → redirect), чтобы поведение
 * существующего клиентского перехватчика 401 осталось неизменным.
 */
export async function refreshSession(req: NextRequest): Promise<RefreshResult> {
  const refreshToken = getTokenFromCookie(req.headers.get('cookie'), 'refresh_token')
  if (!refreshToken) {
    return { ok: false, status: 401, error: 'Не авторизован' }
  }

  let payload
  try {
    payload = verifyToken(refreshToken)
  } catch {
    return { ok: false, status: 401, error: 'Сессия истекла' }
  }

  // Отозванный (использованный/после логаута) refresh-токен повторно не принимаем.
  if (payload.jti && (await isTokenRevoked(payload.jti))) {
    return { ok: false, status: 401, error: 'Сессия недействительна' }
  }

  // Пользователь всё ещё существует?
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true },
  })
  if (!user) {
    return { ok: false, status: 401, error: 'Пользователь не найден' }
  }

  // Ротация: отзываем предъявленный refresh-токен.
  const info = getRevocationInfo(refreshToken)
  if (info && info.ttlSec > 0) {
    await revokeToken(info.jti, info.ttlSec)
  }

  const newPayload = { userId: user.id, email: user.email }
  return {
    ok: true,
    accessToken: signAccessToken(newPayload),
    refreshToken: signRefreshToken(newPayload),
  }
}

/** Параметры установки auth-кук — одни и те же для login/refresh. */
export function accessCookieOptions() {
  const secureCookie = process.env['COOKIE_SECURE'] !== 'false' && process.env['NODE_ENV'] === 'production'
  return { httpOnly: true, secure: secureCookie, sameSite: 'lax' as const, maxAge: 15 * 60, path: '/' }
}

export function refreshCookieOptions() {
  const secureCookie = process.env['COOKIE_SECURE'] !== 'false' && process.env['NODE_ENV'] === 'production'
  return { httpOnly: true, secure: secureCookie, sameSite: 'lax' as const, maxAge: 30 * 24 * 60 * 60, path: '/' }
}
