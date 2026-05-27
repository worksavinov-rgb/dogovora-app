import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, getTokenFromCookie } from '@/lib/auth'

// Публичные маршруты (без авторизации)
const PUBLIC_PATHS = ['/login', '/register', '/api/auth/login', '/api/auth/register']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Пропускаем публичные маршруты и статику
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/ui-kit') ||
    pathname === '/favicon.ico'

  if (isPublic) return NextResponse.next()

  // Проверяем токен
  const token = getTokenFromCookie(req.headers.get('cookie'), 'access_token')

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  try {
    verifyToken(token)
    return NextResponse.next()
  } catch {
    // Токен истёк или невалиден — редирект на логин
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete('access_token')
    return res
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
