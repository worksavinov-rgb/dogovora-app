import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectAmendments, type TrackedAct } from '../src/lib/legal/amendment-detect'
import type { PravoDoc } from '../src/lib/legal/pravo-client'

const doc = (over: Partial<PravoDoc>): PravoDoc => ({
  eoNumber: '1', complexName: '', name: '', number: '', documentDate: '2026-08-04T00:00:00',
  documentTypeId: 'x', pdfFileLength: null, pagesCount: null, id: 'i', ...over,
})

const ooo: TrackedAct = {
  shortName: '14-ФЗ', number: '14-ФЗ',
  matchTerms: ['об обществах с ограниченной ответственностью'],
}

describe('detectAmendments', () => {
  it('находит закон-поправку по фрагменту названия', () => {
    const docs = [
      doc({ eoNumber: 'a', number: '334-ФЗ', complexName: 'Федеральный закон … О внесении изменений в Федеральный закон "Об обществах с ограниченной ответственностью"' }),
      doc({ eoNumber: 'b', number: '335-ФЗ', complexName: 'Федеральный закон … О внесении изменений в Федеральный закон "О рыболовстве"' }),
    ]
    const hits = detectAmendments(ooo, docs)
    expect(hits.map((h) => h.eoNumber)).toEqual(['a'])
    expect(hits[0].matchedTerm).toBe('об обществах с ограниченной ответственностью')
  })

  it('сам акт (без формулы «о внесении изменений») поправкой не считается', () => {
    const docs = [doc({ eoNumber: 'c', number: '14-ФЗ', complexName: 'Федеральный закон … "Об обществах с ограниченной ответственностью"' })]
    expect(detectAmendments(ooo, docs)).toEqual([])
  })

  it('номера ФЗ переиспользуются: поправка с тем же номером, что у акта, НЕ теряется', () => {
    // «14-ФЗ» 2026 года — другой закон, но он вносит изменения в наш акт
    const docs = [doc({ eoNumber: 'd', number: '14-ФЗ', complexName: 'Федеральный закон от 30.01.2026 № 14-ФЗ "О внесении изменений в Федеральный закон "Об обществах с ограниченной ответственностью"' })]
    const hits = detectAmendments(ooo, docs)
    expect(hits.map((h) => h.eoNumber)).toEqual(['d'])
  })

  it('на реальных данных API отделяет поправки к кодексу от ратификаций', () => {
    const real: PravoDoc[] = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/legal/documents-amendments-real.json'), 'utf-8'),
    )
    const lesnoy: TrackedAct = { shortName: 'ЛК РФ', number: 'ЛК', matchTerms: ['лесной кодекс'] }
    const hits = detectAmendments(lesnoy, real)
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      expect(h.complexName.toLowerCase()).toContain('лесной кодекс')
      expect(h.complexName.toLowerCase()).toContain('о внесении изменен')
    }
    // ратификация международного соглашения поправкой к ЛК не считается
    expect(hits.some((h) => h.complexName.toLowerCase().includes('ратификации'))).toBe(false)
  })

  it('пустой список → пусто', () => {
    expect(detectAmendments(ooo, [])).toEqual([])
  })
})
