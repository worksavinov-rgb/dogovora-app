// Служебные таблицы (подписи сторон, «город/дата») в DOCX должны быть БЕЗ рамок.
// Два пути распознавания: по class (документы, сохранённые после фикса TipTap)
// и по структуре+содержимому (старые документы, где class потерялся в редакторе).
import { describe, it, expect } from 'vitest'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { readDocumentXml } from './docx-utils'

const REQS_CELLS =
  '<tr>' +
  '<td><p><strong>Заказчик:</strong></p><p>ООО «Ромашка»</p><p>ИНН: 7707083893</p><p>КПП: 770701001</p><p>Подпись: ____________</p></td>' +
  '<td><p><strong>Исполнитель:</strong></p><p>ИП Савинов П. А.</p><p>ИНН: 502906602876</p><p>Подпись: ____________</p></td>' +
  '</tr>'

const wrap = (inner: string) => `<h1>ДОГОВОР № 1</h1><p>Стороны договорились о нижеследующем.</p>${inner}`

describe('служебные таблицы в DOCX — без рамок', () => {
  it('подписи сторон с class="doc-requisites-table" — без рамок', async () => {
    const docx = await convertToDocx(wrap(`<table class="doc-requisites-table"><tbody>${REQS_CELLS}</tbody></table>`))
    const xml = await readDocumentXml(docx)
    expect(xml).not.toContain('w:val="single"')
  })

  it('подписи сторон без class (старый документ из редактора) — без рамок по эвристике', async () => {
    const docx = await convertToDocx(wrap(`<table><tbody>${REQS_CELLS}</tbody></table>`))
    const xml = await readDocumentXml(docx)
    expect(xml).not.toContain('w:val="single"')
  })

  it('обычная таблица данных 1×2 без маркеров реквизитов — рамки сохраняются', async () => {
    const docx = await convertToDocx(wrap('<table><tbody><tr><td><p>Яблоки</p></td><td><p>10 кг</p></td></tr></tbody></table>'))
    const xml = await readDocumentXml(docx)
    expect(xml).toContain('w:val="single"')
  })

  it('таблица с шапкой (th), даже с ИНН внутри, — рамки сохраняются', async () => {
    const docx = await convertToDocx(wrap('<table><tbody><tr><th>ИНН</th><th>Компания</th></tr><tr><td>7707083893</td><td>ООО «Ромашка»</td></tr></tbody></table>'))
    const xml = await readDocumentXml(docx)
    expect(xml).toContain('w:val="single"')
  })

  it('строка «город/дата» без class (старый документ) — абзацем, без таблицы с рамками', async () => {
    const docx = await convertToDocx(wrap('<table><tbody><tr><td><p>г. Москва</p></td><td><p>1 февраля 2025 г.</p></td></tr></tbody></table>'))
    const xml = await readDocumentXml(docx)
    expect(xml).not.toContain('w:val="single"')
    expect(xml).toContain('г. Москва')
  })
})
