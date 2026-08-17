import { NextRequest, NextResponse } from 'next/server'

// Публичные маршруты (без авторизации)
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/_next',
  // /ui-kit — витрина компонентов, доступна только авторизованным
  '/favicon.ico',
  // Правовые документы читаются без авторизации — на них ссылается форма регистрации
  '/legal',
  // Публичная ссылка «показать контрагенту»: страница и API читаются без логина,
  // доступ контролируется непредсказуемым токеном (см. api/share/[token])
  '/share',
  '/api/share',
]

function ensureRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id')?.trim() || crypto.randomUUID()
}

function withRequestId(req: NextRequest, requestId: string): { requestHeaders: Headers; attach: (res: NextResponse) => NextResponse } {
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  return {
    requestHeaders,
    attach(res: NextResponse) {
      res.headers.set('x-request-id', requestId)
      return res
    },
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const requestId = ensureRequestId(req)
  const { requestHeaders, attach } = withRequestId(req, requestId)

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  if (isPublic) {
    return attach(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  // В Edge Runtime просто проверяем наличие cookie
  // Реальная верификация токена происходит в API роутах
  const token = req.cookies.get('access_token')?.value

  if (!token) {
    // Для API-запросов НЕЛЬЗЯ редиректить на /login: редирект 307 сохраняет
    // метод (POST→/login = 405) и отдаёт HTML вместо JSON. Возвращаем 401 —
    // клиент сам обновит сессию через /api/auth/refresh и повторит запрос.
    if (pathname.startsWith('/api/')) {
      return attach(NextResponse.json({ error: 'Не авторизован' }, { status: 401 }))
    }

    // Access-cookie живёт 15 мин, refresh — 30 дней. Если access истёк, но
    // refresh ещё есть — НЕ выкидываем на /login (это выбрасывало активного
    // пользователя посреди работы). Тихо обновляем сессию через GET-refresh и
    // возвращаем на исходную страницу. Только для GET-навигаций — иначе метод
    // и тело потерялись бы при редиректе.
    const hasRefresh = Boolean(req.cookies.get('refresh_token')?.value)
    if (hasRefresh && req.method === 'GET') {
      const nextPath = pathname + (req.nextUrl.search || '')
      const refreshUrl = new URL('/api/auth/refresh', req.url)
      refreshUrl.searchParams.set('next', nextPath)
      return attach(NextResponse.redirect(refreshUrl))
    }

    return attach(NextResponse.redirect(new URL('/login', req.url)))
  }

  return attach(NextResponse.next({ request: { headers: requestHeaders } }))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
