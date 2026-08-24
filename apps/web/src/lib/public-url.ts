import type { NextRequest } from 'next/server'

/**
 * Абсолютный URL для редиректов, построенный из ПУБЛИЧНОГО хоста (заголовки
 * обратного прокси), а НЕ из req.url.
 *
 * В standalone-режиме Next.js (прод в Docker) `req.url` / `req.nextUrl` несут
 * hostname привязки сервера — `HOSTNAME=0.0.0.0` из Dockerfile. Поэтому
 * `NextResponse.redirect(new URL('/login', req.url))` отдавал браузеру
 * `Location: https://0.0.0.0/...`, и обновление страницы после истечения
 * access-cookie падало с `ERR_SSL_PROTOCOL_ERROR` (сайт 0.0.0.0).
 *
 * nginx проксирует реальный `Host: app.dogodoc.ru` и `X-Forwarded-Proto: https`
 * — берём хост и схему из них. Путь `path` может содержать query-строку.
 */
export function publicUrl(req: NextRequest, path: string): URL {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  // Фолбэк на req.nextUrl.origin — если по какой-то причине хоста в заголовках нет
  // (локальная разработка без прокси), это корректный localhost, а не 0.0.0.0.
  return new URL(path, host ? `${proto}://${host}` : req.nextUrl.origin)
}
