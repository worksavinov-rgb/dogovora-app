import { NextRequest, NextResponse } from 'next/server'
import { refreshSession, accessCookieOptions, refreshCookieOptions } from '@/lib/refresh-session'
import { publicUrl } from '@/lib/public-url'

// POST /api/auth/refresh — обновить access-токен по refresh-токену с РОТАЦИЕЙ.
// Старый refresh-токен отзывается, выдаётся новая пара. Это ограничивает
// последствия кражи refresh-токена: повторное использование старого невозможно.
// Используется клиентским перехватчиком при 401 от API — отвечает JSON.
export async function POST(req: NextRequest) {
  const result = await refreshSession(req)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('access_token', result.accessToken, accessCookieOptions())
  res.cookies.set('refresh_token', result.refreshToken, refreshCookieOptions())
  return res
}

// GET /api/auth/refresh?next=/path — тихое обновление сессии при НАВИГАЦИИ по
// страницам. Middleware перенаправляет сюда, когда access-cookie истекла (15 мин),
// но refresh-токен ещё жив (30 дней). Обновляем пару и возвращаем пользователя
// на исходную страницу — активного (и вернувшегося после простоя) юзера больше
// не выкидывает на /login.
export async function GET(req: NextRequest) {
  // next валидируем как локальный путь — защита от open-redirect на чужой домен.
  const rawNext = req.nextUrl.searchParams.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  const result = await refreshSession(req)
  if (!result.ok) {
    // refresh истёк/отозван — честно отправляем на вход.
    return NextResponse.redirect(publicUrl(req, '/login'))
  }

  // Возврат на исходную страницу — по публичному хосту, а не req.url (0.0.0.0).
  const res = NextResponse.redirect(publicUrl(req, next))
  res.cookies.set('access_token', result.accessToken, accessCookieOptions())
  res.cookies.set('refresh_token', result.refreshToken, refreshCookieOptions())
  return res
}
