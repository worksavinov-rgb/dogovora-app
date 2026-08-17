// Глобальный перехват fetch на клиенте: при 401 на СВОЙ /api/ (кроме /api/auth/*)
// прозрачно обновляет сессию через /api/auth/refresh и ОДИН раз повторяет запрос.
//
// Зачем: access-токен живёт 15 минут. Многие страницы (админка ИИ, баланс,
// контрагенты и т.д.) делают запросы сырым fetch. Если токен истёк во время
// работы, они падали с «Не авторизован»/«Ошибка сохранения». Патч закрывает это
// централизованно на ВСЕХ страницах разом. refresh-токен живёт 30 дней, поэтому
// активный пользователь не теряет действие и не выбрасывается.

let installed = false
// single-flight: если несколько запросов упали в 401 одновременно — обновляем
// сессию ОДИН раз, остальные ждут тот же промис.
let refreshInFlight: Promise<boolean> | null = null

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return String(input)
}

function isSameOriginApi(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin)
    if (u.origin !== window.location.origin) return false
    return u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/auth/')
  } catch {
    return false
  }
}

export function installFetchAuthRetry(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await originalFetch(input, init)
    if (res.status !== 401) return res

    const url = urlOf(input)
    if (!isSameOriginApi(url)) return res

    // Обновляем сессию один раз на все параллельные 401.
    if (!refreshInFlight) {
      refreshInFlight = originalFetch('/api/auth/refresh', { method: 'POST' })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => {
          // сбрасываем чуть позже, чтобы залётные параллельные 401 использовали тот же результат
          setTimeout(() => { refreshInFlight = null }, 0)
        })
    }
    const ok = await refreshInFlight
    if (!ok) return res // сессия истекла окончательно — отдаём исходный 401

    // Повторяем исходный запрос один раз с новой сессией.
    return originalFetch(input, init)
  }
}
