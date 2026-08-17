// Единая точка HTTP-запросов к GigaChat (Сбер).
//
// У Сбера самоподписанный сертификат (корень Минцифры), которого нет в системном
// хранилище. РАНЬШЕ это решалось NODE_TLS_REJECT_UNAUTHORIZED='0' на весь процесс —
// то есть проверка TLS отключалась вообще для всех запросов приложения (Polza,
// OpenRouter, платёжка). Теперь проверка отключена ТОЛЬКО для запросов через этот
// модуль: локальный undici-Agent передаётся как dispatcher конкретному fetch.
//
// Все вызовы GigaChat обязаны идти через gigachatFetch — не через голый fetch.

import { Agent } from 'undici'

// rejectUnauthorized: false — осознанно и только для хостов Сбера.
// Правильная альтернатива — подложить корневой сертификат Минцифры через
// NODE_EXTRA_CA_CERTS; сделаем при пересборке Docker-образа.
const sberAgent = new Agent({ connect: { rejectUnauthorized: false } })

// Таймаут по умолчанию на любой запрос к GigaChat: зависший fetch раньше
// держал воркер/SSE-соединение бесконечно.
const DEFAULT_TIMEOUT_MS = 120_000

export function gigachatFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs, ...rest } = init
  return fetch(url, {
    ...rest,
    // AbortSignal.timeout не затирает переданный signal — объединяем.
    signal: rest.signal
      ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)])
      : AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    // dispatcher — нестандартное поле undici-fetch, TS его не знает.
    ...( { dispatcher: sberAgent } as Record<string, unknown> ),
  })
}
