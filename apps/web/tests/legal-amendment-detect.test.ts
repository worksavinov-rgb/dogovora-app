import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectAmendments, type TrackedAct } from '../src/lib/legal/amendment-detect'
import { coreActByShortName } from '../src/lib/legal/core-acts'
import type { PravoDoc } from '../src/lib/legal/pravo-client'

const doc = (over: Partial<PravoDoc>): PravoDoc => ({
  eoNumber: '1', complexName: '', name: '', number: '', documentDate: '2026-08-04T00:00:00',
  documentTypeId: 'x', pdfFileLength: null, pagesCount: null, id: 'i', ...over,
})

const real: PravoDoc[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/legal/documents-amendments-real.json'), 'utf-8'),
)

const ooo: TrackedAct = {
  shortName: '14-ФЗ (ООО)', number: '14-ФЗ',
  matchPatterns: ['об обществах с ограниченной ответственностью'],
}
const trackedFromCore = (shortName: string): TrackedAct => {
  const a = coreActByShortName(shortName)
  if (!a) throw new Error(`нет акта ${shortName}`)
  return { shortName: a.shortName, number: a.number, matchPatterns: a.matchPatterns }
}

describe('detectAmendments', () => {
  it('находит закон-поправку по фрагменту названия', () => {
    const docs = [
      doc({ eoNumber: 'a', number: '334-ФЗ', complexName: 'Федеральный закон … О внесении изменений в Федеральный закон "Об обществах с ограниченной ответственностью"' }),
      doc({ eoNumber: 'b', number: '335-ФЗ', complexName: 'Федеральный закон … О внесении изменений в Федеральный закон "О рыболовстве"' }),
    ]
    expect(detectAmendments(ooo, docs).map((h) => h.eoNumber)).toEqual(['a'])
  })

  it('сам акт (без формулы «о внесении изменений») поправкой не считается', () => {
    const docs = [doc({ eoNumber: 'c', complexName: 'Федеральный закон … "Об обществах с ограниченной ответственностью"' })]
    expect(detectAmendments(ooo, docs)).toEqual([])
  })

  it('номера ФЗ переиспользуются: поправка с номером самого акта НЕ теряется', () => {
    const docs = [doc({ eoNumber: 'd', number: '14-ФЗ', complexName: 'Федеральный закон от 30.01.2026 № 14-ФЗ "О внесении изменений в Федеральный закон "Об обществах с ограниченной ответственностью"' })]
    expect(detectAmendments(ooo, docs).map((h) => h.eoNumber)).toEqual(['d'])
  })

  it('ловит склонённые названия кодексов на реальных данных API', () => {
    // «в часть четвертую Гражданского кодекса» — родительный падеж
    // Ожидания заданы явно, а не тем же regex, которым отбирались хиты.
    const gk = detectAmendments(trackedFromCore('ГК РФ'), real)
    expect(gk.length).toBeGreaterThan(0)
    for (const h of gk) expect(h.complexName).toContain('Гражданского кодекса')

    const nk = detectAmendments(trackedFromCore('НК РФ'), real)
    expect(nk.length).toBeGreaterThan(0)
    for (const h of nk) expect(h.complexName).toContain('Налогового кодекса')

    // Именительный падеж («Гражданский кодекс») в этих названиях не встречается —
    // подстрочный поиск по нему нашёл бы ноль.
    expect(gk.some((h) => h.complexName.includes('Гражданский кодекс'))).toBe(false)
  })

  it('ГК не путается с Гражданским процессуальным кодексом', () => {
    const gk = detectAmendments(trackedFromCore('ГК РФ'), real)
    expect(gk.some((h) => h.complexName.toLowerCase().includes('процессуальн'))).toBe(false)
    // при этом ГПК-документы в фикстуре есть
    expect(real.some((d) => d.complexName.toLowerCase().includes('процессуальн'))).toBe(true)
  })

  it('ратификация международного протокола поправкой не считается', () => {
    for (const name of ['ГК РФ', 'НК РФ', 'ТК РФ']) {
      const hits = detectAmendments(trackedFromCore(name), real)
      expect(hits.some((h) => h.complexName.toLowerCase().includes('ратификации'))).toBe(false)
    }
  })

  it('битый шаблон не роняет мониторинг', () => {
    const broken: TrackedAct = { shortName: 'X', number: 'X', matchPatterns: ['[незакрытая', 'о рекламе'] }
    const docs = [doc({ eoNumber: 'e', complexName: 'О внесении изменений в Федеральный закон "О рекламе"' })]
    expect(detectAmendments(broken, docs).map((h) => h.eoNumber)).toEqual(['e'])
  })

  it('вложенное название закона не приписывается кодексу', () => {
    // Правится закон-поправка, а не ГК: «в статью 2 Федерального закона
    // "О внесении изменений в Гражданский кодекс"».
    const docs = [doc({
      eoNumber: 'nested',
      complexName: 'Федеральный закон "О внесении изменений в статью 2 Федерального закона "О внесении изменений в Гражданский кодекс Российской Федерации""',
    })]
    expect(detectAmendments(trackedFromCore('ГК РФ'), docs)).toEqual([])
  })

  it('обычная (невложенная) поправка к кодексу по-прежнему ловится', () => {
    const docs = [doc({ eoNumber: 'plain', complexName: 'Федеральный закон "О внесении изменений в часть первую Гражданского кодекса Российской Федерации"' })]
    expect(detectAmendments(trackedFromCore('ГК РФ'), docs).map((h) => h.eoNumber)).toEqual(['plain'])
  })

  it('широкий шаблон «о рекламе» не ловит закон о другом акте', () => {
    const docs = [doc({ eoNumber: 'r', complexName: 'Федеральный закон "О внесении изменений в Федеральный закон "О связи""' })]
    expect(detectAmendments(trackedFromCore('38-ФЗ'), docs)).toEqual([])
  })

  it('пустой список → пусто', () => {
    expect(detectAmendments(ooo, [])).toEqual([])
  })
})
