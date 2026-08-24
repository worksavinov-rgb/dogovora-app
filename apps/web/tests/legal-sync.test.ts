import { describe, it, expect, vi } from 'vitest'
import { syncTrackedActs, type SyncDeps, type TrackedActRecord } from '../src/lib/legal/sync'
import type { DocumentsPage, PravoDoc } from '../src/lib/legal/pravo-client'

const doc = (over: Partial<PravoDoc>): PravoDoc => ({
  eoNumber: '1', complexName: '', name: '', number: '', documentDate: '2026-08-04T00:00:00',
  documentTypeId: 'x', pdfFileLength: null, pagesCount: null, id: 'i', ...over,
})

const page = (items: PravoDoc[], pagesTotalCount = 1): DocumentsPage => ({
  items, itemsTotalCount: items.length, pagesTotalCount, currentPage: 1,
})

const gk: TrackedActRecord = {
  id: 'tr-gk', shortName: 'ГК РФ', number: '51-ФЗ',
  matchPatterns: ['гражданск[а-яё]*\\s+кодекс[а-яё]*'], lastCheckedAt: null,
}
const tk: TrackedActRecord = {
  id: 'tr-tk', shortName: 'ТК РФ', number: '197-ФЗ',
  matchPatterns: ['трудов[а-яё]*\\s+кодекс[а-яё]*'], lastCheckedAt: null,
}

function makeDeps(over: Partial<SyncDeps> = {}, tracked: TrackedActRecord[] = [gk, tk]): SyncDeps {
  return {
    search: vi.fn(async () => page([
      doc({ eoNumber: 'a', complexName: 'О внесении изменений в часть первую Гражданского кодекса Российской Федерации' }),
      doc({ eoNumber: 'b', complexName: 'О внесении изменений в Трудовой кодекс Российской Федерации' }),
      doc({ eoNumber: 'c', complexName: 'О ратификации Протокола' }),
    ])),
    loadTracked: vi.fn(async () => tracked),
    saveAlerts: vi.fn(async (_id, hits) => hits.length),
    markChecked: vi.fn(async () => {}),
    ...over,
  }
}

describe('syncTrackedActs', () => {
  it('одним проходом по API находит поправки для всех отслеживаемых актов', async () => {
    const deps = makeDeps()
    const rep = await syncTrackedActs(deps, { now: new Date('2026-08-10T00:00:00Z') })
    expect(rep.newAlertsByAct).toEqual({ 'ГК РФ': 1, 'ТК РФ': 1 })
    expect(rep.totalNewAlerts).toBe(2)
    // важно: один запрос к API на все акты, а не по одному на акт
    expect(deps.search).toHaveBeenCalledTimes(1)
  })

  it('отмечает проверку у каждого акта', async () => {
    const deps = makeDeps()
    const now = new Date('2026-08-10T00:00:00Z')
    await syncTrackedActs(deps, { now })
    expect(deps.markChecked).toHaveBeenCalledTimes(2)
    expect(deps.markChecked).toHaveBeenCalledWith('tr-gk', now)
  })

  it('берёт самую раннюю lastCheckedAt как точку старта', async () => {
    const a = { ...gk, lastCheckedAt: new Date('2026-07-01T00:00:00Z') }
    const b = { ...tk, lastCheckedAt: new Date('2026-06-01T00:00:00Z') }
    const deps = makeDeps({}, [a, b])
    await syncTrackedActs(deps, { now: new Date('2026-08-10T00:00:00Z') })
    const params = (deps.search as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.publishDateFrom).toEqual(new Date('2026-06-01T00:00:00Z'))
  })

  it('если хоть у одного акта нет lastCheckedAt — берёт дату по умолчанию', async () => {
    const a = { ...gk, lastCheckedAt: new Date('2026-07-01T00:00:00Z') }
    const deps = makeDeps({}, [a, tk]) // у tk lastCheckedAt = null
    const since = new Date('2026-01-01T00:00:00Z')
    await syncTrackedActs(deps, { now: new Date('2026-08-10T00:00:00Z'), defaultSince: since })
    const params = (deps.search as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.publishDateFrom).toEqual(since)
  })

  it('листает страницы и уважает предохранитель maxPages', async () => {
    const search = vi.fn(async () => page([doc({ eoNumber: 'x', complexName: 'О внесении изменений в Трудовой кодекс' })], 50))
    const deps = makeDeps({ search })
    const rep = await syncTrackedActs(deps, { maxPages: 3, now: new Date('2026-08-10T00:00:00Z') })
    expect(search).toHaveBeenCalledTimes(3)
    expect(rep.pagesFetched).toBe(3)
  })

  it('пустая страница обрывает пагинацию', async () => {
    const search = vi.fn(async () => page([], 50))
    const deps = makeDeps({ search })
    const rep = await syncTrackedActs(deps, { maxPages: 10, now: new Date('2026-08-10T00:00:00Z') })
    expect(search).toHaveBeenCalledTimes(1)
    expect(rep.scannedDocuments).toBe(0)
  })

  it('нет отслеживаемых актов → в API не ходим', async () => {
    const deps = makeDeps({}, [])
    const rep = await syncTrackedActs(deps, { now: new Date('2026-08-10T00:00:00Z') })
    expect(deps.search).not.toHaveBeenCalled()
    expect(rep.totalNewAlerts).toBe(0)
  })

  it('saveAlerts не зовётся, если поправок нет', async () => {
    const search = vi.fn(async () => page([doc({ eoNumber: 'z', complexName: 'О ратификации Протокола' })]))
    const deps = makeDeps({ search })
    await syncTrackedActs(deps, { now: new Date('2026-08-10T00:00:00Z') })
    expect(deps.saveAlerts).not.toHaveBeenCalled()
  })
})

describe('syncTrackedActs — защита от потери документов', () => {
  it('при обрыве по maxPages НЕ сдвигает отметку проверки', async () => {
    // Иначе непрочитанные страницы не будут просмотрены никогда.
    const search = vi.fn(async () => page([doc({ eoNumber: 'x', complexName: 'О внесении изменений в Трудовой кодекс' })], 79))
    const deps = makeDeps({ search })
    const rep = await syncTrackedActs(deps, { maxPages: 2, now: new Date('2026-08-10T00:00:00Z') })
    expect(rep.truncated).toBe(true)
    expect(deps.markChecked).not.toHaveBeenCalled()
  })

  it('когда окно дочитано — отметку сдвигает', async () => {
    const deps = makeDeps()
    const rep = await syncTrackedActs(deps, { maxPages: 20, now: new Date('2026-08-10T00:00:00Z') })
    expect(rep.truncated).toBe(false)
    expect(deps.markChecked).toHaveBeenCalledTimes(2)
  })

  it('новый акт в реестре бэкфиллится с defaultSince, а не с окна соседей', async () => {
    const old = { ...gk, lastCheckedAt: new Date('2026-08-01T00:00:00Z') } // давно проверяется
    const fresh = { ...tk, lastCheckedAt: null }                            // только добавлен
    const deps = makeDeps({}, [old, fresh])
    const backfill = new Date('2024-01-01T00:00:00Z')
    await syncTrackedActs(deps, { now: new Date('2026-08-10T00:00:00Z'), defaultSince: backfill })
    const params = (deps.search as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.publishDateFrom).toEqual(backfill)
  })
})
