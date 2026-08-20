import { describe, it, expect } from 'vitest'
import { hasInlineRequisites, buildRequisitesHtml } from '../src/lib/html-document'
import type { UserProfileData, CounterpartyData } from '../src/lib/ai/types'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { readDocumentXml, docxPlainText } from './docx-utils'

describe('hasInlineRequisites', () => {
  it('находит вклеенный системный блок реквизитов (legacy-версии)', () => {
    const reqs = buildRequisitesHtml(
      { name: 'ООО Ромашка', inn: '7700000000' } as UserProfileData,
      { name: 'ИП Иванов', inn: '770000000000' } as CounterpartyData,
      'Заказчик', 'Исполнитель',
    )
    expect(hasInlineRequisites(`<h2>1. Предмет договора</h2><p>Текст.</p>${reqs}`)).toBe(true)
  })

  it('находит блок с заголовком «РЕКВИЗИТЫ И ПОДПИСИ СТОРОН» абзацами', () => {
    const html = '<h2>1. Предмет</h2><p>Текст.</p><h2>РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2><p>ИНН: 7700000000</p>'
    expect(hasInlineRequisites(html)).toBe(true)
  })

  it('не срабатывает на теле без блока', () => {
    expect(hasInlineRequisites('<h2>1. Предмет</h2><p>Стороны согласовали порядок оплаты и сроки выполнения работ.</p>')).toBe(false)
  })

  it('не срабатывает на пустом контенте', () => {
    expect(hasInlineRequisites('')).toBe(false)
  })
})

// ─── Реквизиты из редактора ───────────────────────────────────────────────────
// Редактор не умеет <div>, поэтому колонки переводятся в таблицу
// (layoutDivsToTables). Такая таблица должна попасть в Word без сетки — как и
// вариант с колонками-div, иначе в скачанном файле появятся линии.
describe('реквизиты в виде таблицы (из редактора)', () => {
  const tableHtml = [
    '<h2 class="doc-requisites-title">РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2>',
    '<table class="doc-requisites-table"><tbody><tr>',
    '<td><p><strong>Исполнитель:</strong></p><p>ИНН: 772446352670</p></td>',
    '<td><p><strong>Заказчик:</strong></p><p>ИНН: 7719290541</p></td>',
    '</tr></tbody></table>',
  ].join('')

  it('обе стороны попадают в документ', async () => {
    const text = docxPlainText(await readDocumentXml(await convertToDocx(tableHtml, { title: 'Тест' })))
    expect(text).toContain('Исполнитель')
    expect(text).toContain('Заказчик')
    expect(text).toContain('772446352670')
    expect(text).toContain('7719290541')
  })

  it('таблица идёт без видимых рамок', async () => {
    const xml = await readDocumentXml(await convertToDocx(tableHtml, { title: 'Тест' }))
    // В блоке реквизитов не должно быть одиночных линий сетки
    expect(xml).not.toMatch(/w:tblBorders>[\s\S]*?w:val="single"/)
  })
})
