import { NextRequest, NextResponse } from 'next/server'

// Публичные маршруты (без авторизации)
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/_next',
  '/ui-kit',
  '/favicon.ico',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  if (isPublic) return NextResponse.next()

  // В Edge Runtime просто проверяем наличие cookie
  // Реальная верификация токена происходит в API роутах
  const token = req.cookies.get('access_token')?.value

  if (!token) {
    // Для API-запросов НЕЛЬЗЯ редиректить на /login: редирект 307 сохраняет
    // метод (POST→/login = 405) и отдаёт HTML вместо JSON. Возвращаем 401 —
    // клиент сам обновит сессию через /api/auth/refresh и повторит запрос.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
