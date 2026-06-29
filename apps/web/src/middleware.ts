import { NextRequest, NextResponse } from 'next/server'

// Публичные маршруты (без авторизации)
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
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
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
