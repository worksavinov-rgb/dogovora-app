// Тесты вырезания шаблонной шапки (stripLeadingPreamble) и старого блока
// реквизитов (stripRequisitesSection) при выгрузке в Word. Обе функции не
// экспортированы — тестируем через convertToDocx с опциями preamble/requisites:
// старый блок должен быть вырезан, системный — вставлен, приложения — уцелеть.
import { describe, it, expect } from 'vitest'
import { convertToDocx, type RequisitesParty } from '@shared/formatting/html-docx-converter'
import { readDocumentXml, docxPlainText } from './docx-utils'

// ─── Эталонные стороны (как приходят из ЛК) ───────────────────────────────────

const CUSTOMER: RequisitesParty = {
  type: 'COMPANY',
  name: 'ООО «Ромашка»',
  inn: '7707083893',
  kpp: '770701001',
  ogrn: '1027700132195',
  legalAddress: 'г. Москва, ул. Ленина, д. 1',
  email: 'info@romashka.ru',
  signatorName: 'Иванов Иван Иванович',
  signatorPosition: 'Генеральный директор',
  bankName: 'ПАО Сбербанк',
  bik: '044525225',
  checkingAccount: '40702810400000012345',
  correspondentAccount: '30101810400000000225',
}

const EXECUTOR: RequisitesParty = {
  type: 'SOLE_PROPRIETOR',
  name: 'ИП Савинов Павел Андреевич',
  inn: '502906602876',
  ogrn: '323508100000001',
  legalAddress: 'Московская область, г. Пушкино',
  email: 'work@savinov.ru',
  signatorName: 'Савинов Павел Андреевич',
  signatorPosition: null,
  bankName: 'АО «Тинькофф Банк»',
  bik: '044525974',
  checkingAccount: '40802810900001234567',
  correspondentAccount: '30101810145250000974',
}

const REQUISITES_OPTS = {
  left: CUSTOMER,
  right: EXECUTOR,
  leftTitle: 'Заказчик',
  rightTitle: 'Исполнитель',
  docType: 'CONTRACT' as const,
}

// Устаревшие реквизиты, которые ИИ/Word мог оставить в теле документа —
// после конвертации их быть не должно (система ставит свои).
const OLD_REQUISITES = [
  '<h2>Реквизиты и подписи сторон</h2>',
  '<p><strong>Заказчик:</strong></p>',
  '<p>АО «СтарБанк-Клиент»</p>',
  '<p>ИНН: 1111111111</p>',
  '<p>Банк: АО «СтарБанк»</p>',
  '<p><strong>Исполнитель:</strong></p>',
  '<p>ИНН: 2222222222</p>',
].join('\n')

const BODY_SECTIONS = [
  '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
  '<p>1.1. Исполнитель обязуется оказать услуги по организации мероприятия, а Заказчик — принять и оплатить их.</p>',
  '<h2>2. СТОИМОСТЬ УСЛУГ</h2>',
  '<p>2.1. Стоимость услуг согласовывается Сторонами в Заявках.</p>',
  '<h2>3. ОТВЕТСТВЕННОСТЬ СТОРОН</h2>',
  '<p>3.1. За неисполнение обязательств Стороны несут ответственность по законодательству РФ.</p>',
].join('\n')

// ─── Тесты ────────────────────────────────────────────────────────────────────

describe('convertToDocx с opts.requisites — замена старого блока реквизитов', () => {
  it('старый блок вырезан, системный вставлен, тело договора цело', async () => {
    const html = [BODY_SECTIONS, OLD_REQUISITES].join('\n')
    const buffer = await convertToDocx(html, { requisites: REQUISITES_OPTS })
    const docText = docxPlainText(await readDocumentXml(buffer))

    // Старые реквизиты вырезаны
    expect(docText).not.toContain('1111111111')
    expect(docText).not.toContain('2222222222')
    expect(docText).not.toContain('СтарБанк')

    // Системный блок вставлен: заголовок раздела и реквизиты обеих сторон из ЛК
    expect(docText).toContain('Реквизиты и подписи сторон')
    expect(docText).toContain(CUSTOMER.inn!)
    expect(docText).toContain(EXECUTOR.inn!)
    expect(docText).toContain('ПАО Сбербанк')
    expect(docText).toContain('40802810900001234567')

    // Тело договора не пострадало
    expect(docText).toContain('1. ПРЕДМЕТ ДОГОВОРА')
    expect(docText).toContain('3.1. За неисполнение обязательств')

    // Финальный раздел получил следующий номер после «3. …»
    expect(docText).toContain('4. Реквизиты и подписи сторон')
  })

  it('старые реквизиты ТАБЛИЦЕЙ в конце тоже вырезаются', async () => {
    const html = [
      BODY_SECTIONS,
      '<p>Подписи сторон</p>',
      '<table><tbody><tr>',
      '<td><p>Заказчик:</p><p>ИНН: 1111111111</p></td>',
      '<td><p>Исполнитель:</p><p>ИНН: 2222222222</p></td>',
      '</tr></tbody></table>',
    ].join('\n')
    const buffer = await convertToDocx(html, { requisites: REQUISITES_OPTS })
    const docText = docxPlainText(await readDocumentXml(buffer))

    expect(docText).not.toContain('1111111111')
    expect(docText).not.toContain('2222222222')
    expect(docText).toContain(CUSTOMER.inn!)
    expect(docText).toContain(EXECUTOR.inn!)
    expect(docText).toContain('3.1. За неисполнение обязательств')
  })

  // Регресс-тест: stripRequisitesSection в html-docx-converter.ts раньше не имел
  // защиты hasSectionsAfter (в отличие от splitRequisitesBlock) — раздел
  // «13. Место нахождения…» в СЕРЕДИНЕ документа принимался за подвал, и всё
  // после него (ПРИЛОЖЕНИЕ №1 и №2) вырезалось из DOCX. Исправлено 2026-08-17.
  it('реквизиты в СЕРЕДИНЕ документа + приложения после: приложения должны уцелеть', async () => {
    const html = [
      BODY_SECTIONS,
      '<h2>13. МЕСТО НАХОЖДЕНИЯ И БАНКОВСКИЕ РЕКВИЗИТЫ СТОРОН</h2>',
      '<p><strong>Заказчик:</strong></p>',
      '<p>ИНН: 1111111111</p>',
      '<p><strong>Исполнитель:</strong></p>',
      '<p>ИНН: 2222222222</p>',
      '<h2>ПРИЛОЖЕНИЕ №1 к Договору</h2>',
      '<p>ЗАЯВКА на оказание услуг: конференция, 12 октября 2025 года, конгресс-центр.</p>',
      '<h2>ПРИЛОЖЕНИЕ №2 к Договору</h2>',
      '<p>Форма акта сдачи-приёмки оказанных услуг.</p>',
    ].join('\n')
    const buffer = await convertToDocx(html, { requisites: REQUISITES_OPTS })
    const docText = docxPlainText(await readDocumentXml(buffer))

    // Приложения не должны быть отрезаны вместе со старым блоком реквизитов
    expect(docText).toContain('ПРИЛОЖЕНИЕ №1')
    expect(docText).toContain('ЗАЯВКА на оказание услуг')
    expect(docText).toContain('ПРИЛОЖЕНИЕ №2')
    // Системные реквизиты при этом вставлены
    expect(docText).toContain(CUSTOMER.inn!)
    expect(docText).toContain(EXECUTOR.inn!)
  })
})

describe('convertToDocx с opts.preamble — замена шаблонной шапки', () => {
  it('шаблонная шапка с прочерками вырезана, системная преамбула вставлена', async () => {
    const html = [
      '<h1>ДОГОВОР ВОЗМЕЗДНОГО ОКАЗАНИЯ УСЛУГ № 000-ШАБЛОН</h1>',
      '<p>г. ________ «___» ____________ 20__ г.</p>',
      '<p>________________, именуемое в дальнейшем «Заказчик», в лице ________, действующего на основании ________, с одной стороны, и ________, именуемый в дальнейшем «Исполнитель», с другой стороны, заключили настоящий Договор о нижеследующем:</p>',
      BODY_SECTIONS,
    ].join('\n')
    const buffer = await convertToDocx(html, {
      preamble: {
        docTitle: 'Договор оказания услуг',
        docNumber: '42',
        city: 'Москва',
        date: '1 февраля 2026 г.',
        customer: CUSTOMER,
        executor: EXECUTOR,
      },
    })
    const docText = docxPlainText(await readDocumentXml(buffer))

    // Шаблонная шапка удалена
    expect(docText).not.toContain('000-ШАБЛОН')
    // Системная преамбула на месте: заголовок, город/дата, стороны с ФИО
    expect(docText).toContain('Договор оказания услуг № 42')
    expect(docText).toContain('г. Москва')
    expect(docText).toContain('1 февраля 2026 г.')
    expect(docText).toContain('именуемое в дальнейшем «Заказчик»')
    expect(docText).toContain('Иванов Иван Иванович')
    expect(docText).toContain('Индивидуальный предприниматель Савинов Павел Андреевич')
    // Тело договора начинается с раздела 1 и цело
    expect(docText).toContain('1. ПРЕДМЕТ ДОГОВОРА')
    expect(docText).toContain('3.1. За неисполнение обязательств')
  })

  it('документ без раздела «1. …» не трогается (преамбула просто добавляется сверху)', async () => {
    const html = '<p>Короткий текст без нумерованных разделов и без шапки.</p>'
    const buffer = await convertToDocx(html, {
      preamble: {
        docTitle: 'Договор оказания услуг',
        docNumber: null,
        city: null,
        date: null,
        customer: CUSTOMER,
        executor: EXECUTOR,
      },
    })
    const docText = docxPlainText(await readDocumentXml(buffer))

    expect(docText).toContain('Короткий текст без нумерованных разделов')
    expect(docText).toContain('Договор оказания услуг')
  })
})
