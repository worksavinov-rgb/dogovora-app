import { describe, it, expect } from 'vitest'
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
      doc({ eoNumber: 'b', number: '335-ФЗ', complexName: 'Федеральный закон … О рыболовстве' }),
    ]
    const hits = detectAmendments(ooo, docs)
    expect(hits.map((h) => h.eoNumber)).toEqual(['a'])
    expect(hits[0].matchedTerm).toBe('об обществах с ограниченной ответственностью')
  })

  it('игнорирует переиздание самого акта (тот же номер)', () => {
    const docs = [doc({ eoNumber: 'c', number: '14-ФЗ', complexName: 'Федеральный закон … Об обществах с ограниченной ответственностью' })]
    expect(detectAmendments(ooo, docs)).toEqual([])
  })

  it('пустой список → пусто', () => {
    expect(detectAmendments(ooo, [])).toEqual([])
  })
})
