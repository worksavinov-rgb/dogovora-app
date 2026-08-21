import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../src/middleware'

function makeReq(url: string, method: string) {
  // Без cookie — имитируем анонимный запрос (нотификация банка или чужой клиент).
  return new NextRequest(url, { method })
}

describe('middleware — PUBLIC_PATHS', () => {
  it('POST /api/payments/webhook без cookie пропускается (не 401) — нотификация банка не имеет сессии', async () => {
    const res = middleware(makeReq('https://example.test/api/payments/webhook', 'POST'))
    expect(res.status).not.toBe(401)
  })

  it('POST /api/payments/create без cookie отклоняется 401 — создание платежа требует сессии пользователя', async () => {
    const res = middleware(makeReq('https://example.test/api/payments/create', 'POST'))
    expect(res.status).toBe(401)
  })

  it('GET /api/payments/create без cookie тоже отклоняется 401', async () => {
    const res = middleware(makeReq('https://example.test/api/payments/create', 'GET'))
    expect(res.status).toBe(401)
  })

  it('GET /api/payments/packages без cookie отклоняется 401 (сегодня список пакетов не публичный)', async () => {
    const res = middleware(makeReq('https://example.test/api/payments/packages', 'GET'))
    expect(res.status).toBe(401)
  })

  it('GET /api/payments/abc/status без cookie отклоняется 401 (сегодня статус не публичный)', async () => {
    const res = middleware(makeReq('https://example.test/api/payments/abc/status', 'GET'))
    expect(res.status).toBe(401)
  })

  it('добавление /api/payments/webhook в PUBLIC_PATHS не задевает соседние /api/payments/* маршруты (startsWith, но разные префиксы)', async () => {
    // Именно /api/payments/webhook, а не /api/payments — соседние create/packages/[id]/status
    // не начинаются со строки "/api/payments/webhook", поэтому startsWith их не откроет.
    const webhook = middleware(makeReq('https://example.test/api/payments/webhook', 'POST'))
    const create = middleware(makeReq('https://example.test/api/payments/create', 'POST'))
    const packages = middleware(makeReq('https://example.test/api/payments/packages', 'GET'))
    const status = middleware(makeReq('https://example.test/api/payments/abc/status', 'GET'))
    expect(webhook.status).not.toBe(401)
    expect(create.status).toBe(401)
    expect(packages.status).toBe(401)
    expect(status.status).toBe(401)
  })
})
