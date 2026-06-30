// ─── Клиентский fetch с авто-обновлением сессии ────────────────────────────────
// Access-токен живёт 15 минут. Если он истёк во время работы, запрос вернёт 401.
// Тогда прозрачно дёргаем /api/auth/refresh (refresh-токен живёт 30 дней) и
// повторяем исходный запрос один раз. Так пользователь не теряет действие
// (например, сохранение черновика) из-за истёкшего токена.

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  // Не пытаемся обновлять для самих auth-эндпоинтов.
  if (res.status !== 401 || input.includes('/api/auth/')) return res

  const refreshed = await fetch('/api/auth/refresh', { method: 'POST' })
  if (!refreshed.ok) return res // сессия истекла окончательно — отдаём исходный 401

  // Тело запроса — строка (JSON), её можно безопасно переиспользовать при повторе.
  return fetch(input, init)
}
