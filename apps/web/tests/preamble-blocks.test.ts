// Шапка документа: заголовок «ДОГОВОР № …», подписант контрагента без флага
// «по умолчанию» и защита шапки от ИИ.
//
// Это защитные тесты по трём жалобам владельца (2026-08-20):
//  1) в шапке основного договора не было строки «ДОГОВОР № X» по центру;
//  2) в шапке стояли прочерки «в лице ____», хотя подписант в карточке заполнен —
//     предпросмотр брал строго isDefault:true, а DOCX — через общий резолвер;
//  3) ИИ переписывал шапку при точечной правке пункта.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import {
  buildContractPreambleHtml,
  buildChildDocPreambleHtml,
  splitDocumentPreamble,
  stripAiPreamble,
  preambleMetaToTable,
} from '@/lib/html-document'
import type { CounterpartyData, UserProfileData } from '@/lib/ai/types'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { readDocumentXml, docxPlainText } from './docx-utils'

const PROFILE: UserProfileData = {
  type: 'COMPANY',
  name: 'ООО «Догодок»',
  inn: '7714415571',
  kpp: '771401001',
  ogrn: '1157746000000',
  legalAddress: 'г. Москва, ул. Тверская, д. 1',
  signatorName: 'Иванов Иван Иванович',
  signatorPosition: 'генерального директора',
  signatorBasis: 'CHARTER',
} as UserProfileData

const COUNTERPARTY: CounterpartyData = {
  name: 'ООО «АЙЛАБМЕД»',
  inn: '7714415572',
  kpp: '771401002',
  ogrn: '1157746000001',
  legalAddress: 'г. Москва, ул. Ленина, д. 2',
  signatorName: 'Петров Пётр Петрович',
  signatorPosition: 'президента',
  signatorBasis: 'Устава',
} as CounterpartyData

describe('buildContractPreambleHtml — заголовок документа', () => {
  it('с номером договора — «ДОГОВОР № 19/03-ЛАБ» в заголовке', () => {
    const html = buildContractPreambleHtml(PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель', 'Москва', undefined, '19/03-ЛАБ')
    expect(html).toContain('ДОГОВОР № 19/03-ЛАБ')
    expect(html).toContain('doc-preamble-title')
  })

  it('заголовок центрируется классом ta-center (его понимают и предпросмотр, и DOCX)', () => {
    const html = buildContractPreambleHtml(PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель')
    expect(html).toMatch(/class="doc-preamble-title ta-center"/)
  })

  it('без номера — просто «ДОГОВОР», без висящего знака №', () => {
    const html = buildContractPreambleHtml(PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель')
    expect(html).toContain('<strong>ДОГОВОР</strong>')
    expect(html).not.toContain('№')
  })

  it('пустой/пробельный номер приравнивается к отсутствию номера', () => {
    const html = buildContractPreambleHtml(PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель', undefined, undefined, '   ')
    expect(html).toContain('<strong>ДОГОВОР</strong>')
    expect(html).not.toContain('№')
  })

  it('заголовок идёт ПЕРЕД строкой «город — дата» и абзацем сторон', () => {
    const html = buildContractPreambleHtml(PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель', 'Москва', undefined, '7')
    expect(html.indexOf('doc-preamble-title')).toBeLessThan(html.indexOf('doc-preamble-meta'))
    expect(html.indexOf('doc-preamble-meta')).toBeLessThan(html.indexOf('class="doc-preamble"'))
  })

  it('шапка по-прежнему представляет обе стороны и подписанта контрагента', () => {
    const html = buildContractPreambleHtml(PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель')
    expect(html).toContain('Петров Пётр Петрович')
    expect(html).toContain('президента')
    expect(html).not.toContain('_____________')
  })
})

describe('buildChildDocPreambleHtml — заголовок приложения/ДС', () => {
  it('заголовок тоже центрируется классом ta-center', () => {
    const html = buildChildDocPreambleHtml(
      PROFILE, COUNTERPARTY, 'Заказчик', 'Исполнитель', 'APPENDIX', 1, '19/03-ЛАБ',
    )
    expect(html).toMatch(/class="doc-preamble-title ta-center"/)
    expect(html).toContain('Приложение № 1 к Договору № 19/03-ЛАБ')
  })
})

describe('splitDocumentPreamble — шапку не отдаём ИИ', () => {
  const PREAMBLE = [
    '<p class="doc-preamble-title ta-center"><strong>ДОГОВОР № 7</strong></p>',
    '<p class="doc-preamble-meta"><span>г. Москва</span><span>1 марта 2026 г.</span></p>',
    '<p class="doc-preamble">ООО «Догодок» в лице директора…, именуемое «Заказчик», заключили…</p>',
  ].join('\n')
  const BODY = [
    '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
    '<p>1.1. Исполнитель оказывает услуги.</p>',
  ].join('\n')

  it('делит документ на шапку и тело по первому заголовку раздела', () => {
    const { preamble, body } = splitDocumentPreamble(`${PREAMBLE}\n${BODY}`)
    expect(preamble).toContain('ДОГОВОР № 7')
    expect(preamble).toContain('doc-preamble')
    expect(body).toBe(BODY)
    expect(body).not.toContain('doc-preamble')
  })

  it('склейка шапки и тела возвращает исходный документ', () => {
    const html = `${PREAMBLE}\n${BODY}`
    const { preamble, body } = splitDocumentPreamble(html)
    expect(`${preamble}\n${body}`).toBe(html)
  })

  it('документ без шапки (сразу заголовок раздела) отдаётся телом целиком', () => {
    const { preamble, body } = splitDocumentPreamble(BODY)
    expect(preamble).toBe('')
    expect(body).toBe(BODY)
  })

  it('документ без заголовков разделов не режем — шапки нет, тело целиком', () => {
    const plain = '<p>Просто абзац без разделов.</p>'
    expect(splitDocumentPreamble(plain)).toEqual({ preamble: '', body: plain })
  })

  it('stripAiPreamble сохраняет прежнее поведение (тело без шапки)', () => {
    expect(stripAiPreamble(`${PREAMBLE}\n${BODY}`)).toBe(BODY)
    expect(stripAiPreamble(BODY)).toBe(BODY)
  })
})

// ─── Строка «город … дата» переживает ручную правку ──────────────────────────
// Редактор не сохраняет произвольные <span>, поэтому город и дата слипались
// («г. Москва12 февраля 2026 г.») — и на экране, и в скачанном Word.
describe('preambleMetaToTable', () => {
  const meta = '<p class="doc-preamble-meta"><span class="doc-preamble-city">г. Москва</span><span class="doc-preamble-date">12 февраля 2026 г.</span></p>'

  it('переводит строку в таблицу с двумя ячейками', () => {
    const out = preambleMetaToTable(meta)
    expect(out).toContain('doc-preamble-meta-table')
    expect(out).toContain('<td>г. Москва</td>')
    expect(out).toContain('12 февраля 2026 г.')
  })

  it('не трогает документы без этой строки', () => {
    const html = '<p>Обычный абзац договора.</p>'
    expect(preambleMetaToTable(html)).toBe(html)
  })

  it('в Word город и дата остаются разделёнными', async () => {
    const xml = await readDocumentXml(await convertToDocx(preambleMetaToTable(meta), { title: 'Тест' }))
    const text = docxPlainText(xml)
    // Между городом и датой — табуляция (правый таб-стоп), а не пустота
    expect(text).toMatch(/г\. Москва\s+12 февраля 2026 г\./)
    expect(text).not.toContain('Москва12')
  })
})
