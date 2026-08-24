import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listDocumentTypes, searchDocuments, hasDocumentText,
  DOC_TYPE_FEDERAL_LAW, PRAVO_BASE_URL, toPravoDate,
  type FetchLike,
} from '../src/lib/legal/pravo-client'

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures/legal', name), 'utf-8'))

function fakeFetch(routes: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' }
    const body = routes[key]
    return {
      ok: true, status: 200,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }
}

describe('pravo-client', () => {
  it('парсит типы документов и находит ГУИД Федерального закона', async () => {
    const f = fakeFetch({ '/api/DocumentTypes': fx('document-types.json') })
    const types = await listDocumentTypes(f)
    expect(types.length).toBeGreaterThan(0)
    expect(types.find((t) => t.id === DOC_TYPE_FEDERAL_LAW)?.name).toBe('Федеральный закон')
  })

  it('парсит страницу документов с пагинацией', async () => {
    const f = fakeFetch({ '/api/Documents': fx('documents-fz-page.json') })
    const page = await searchDocuments({ documentTypes: [DOC_TYPE_FEDERAL_LAW], pageSize: 100 }, f)
    expect(page.items.length).toBe(2)
    expect(page.items[0].eoNumber).toMatch(/^\d+$/)
    expect(page.items[0].number).toBeTruthy()
    expect(typeof page.itemsTotalCount).toBe('number')
    expect(typeof page.pagesTotalCount).toBe('number')
  })

  it('передаёт фильтры в query string', async () => {
    let called = ''
    const f: FetchLike = async (url) => { called = url; return { ok: true, status: 200, json: async () => fx('documents-fz-page.json'), text: async () => '' } }
    await searchDocuments({ documentTypes: [DOC_TYPE_FEDERAL_LAW], number: '14-ФЗ', pageSize: 100, index: 1 }, f)
    expect(called).toContain(PRAVO_BASE_URL)
    expect(called).toContain('/api/Documents')
    expect(called).toContain('DocumentTypes=82a8bf1c-3bc7-47ed-827f-7affd43a7f27')
    expect(called).toContain('Number=14-%D0%A4%D0%97')
    expect(called).toContain('PageSize=100')
  })

  it('hasDocumentText возвращает булево по ответу true/false', async () => {
    const fTrue = fakeFetch({ '/api/DocumentText': 'true' })
    const fFalse = fakeFetch({ '/api/DocumentText': 'false' })
    expect(await hasDocumentText('0001202608040073', fTrue)).toBe(true)
    expect(await hasDocumentText('0001202608040078', fFalse)).toBe(false)
  })

  it('на ошибку HTTP бросает исключение', async () => {
    const f: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })
    await expect(listDocumentTypes(f)).rejects.toThrow()
  })
})

describe('toPravoDate', () => {
  it('форматирует дату как ДД.ММ.ГГГГ (ISO портал молча игнорирует)', () => {
    expect(toPravoDate(new Date('2026-08-01T00:00:00Z'))).toBe('01.08.2026')
    expect(toPravoDate('2026-12-31')).toBe('31.12.2026')
  })

  it('фильтр дат уходит в запрос в русском формате', async () => {
    let called = ''
    const f: FetchLike = async (url) => {
      called = url
      return { ok: true, status: 200, json: async () => ({ items: [] }), text: async () => '' }
    }
    await searchDocuments({ publishDateFrom: '2026-08-01' }, f)
    expect(called).toContain('PublishDateFrom=01.08.2026')
    expect(called).not.toContain('2026-08-01')
  })
})
