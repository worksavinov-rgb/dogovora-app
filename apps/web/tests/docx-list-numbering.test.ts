// Многоуровневая нумерация списков в DOCX должна совпадать с предпросмотром
// (CSS-счётчики): 1., 1.1., 1.1.1., а также стили alpha/roman из класса <ol>.
// Номера конвертер считает сам и вставляет текстом — проверяем их наличие и порядок.
import { describe, it, expect } from 'vitest'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { readDocumentXml, docxPlainText } from './docx-utils'

async function toText(html: string): Promise<string> {
  const buf = await convertToDocx(html)
  return docxPlainText(await readDocumentXml(buf))
}

describe('convertToDocx — нумерация списков', () => {
  it('вложенный legal-список даёт сквозные номера 1., 1.1., 1.1.1.', async () => {
    const html = [
      '<ol class="ol-legal">',
      '<li><p>Первый пункт</p>',
      '<ol class="ol-legal"><li><p>Подпункт один</p></li><li><p>Подпункт два</p></li></ol>',
      '</li>',
      '<li><p>Второй пункт</p></li>',
      '</ol>',
    ].join('')
    const text = await toText(html)

    // Номера верхнего и вложенного уровней присутствуют и в правильном порядке
    expect(text).toMatch(/1\.\s*Первый пункт/)
    expect(text).toMatch(/1\.1\.\s*Подпункт один/)
    expect(text).toMatch(/1\.2\.\s*Подпункт два/)
    expect(text).toMatch(/2\.\s*Второй пункт/)
    // Текст вложенного пункта НЕ склеен со строкой родителя
    expect(text).not.toMatch(/Первый пункт\s*Подпункт один/)
  })

  it('стиль alpha даёт a), b); roman — i), ii)', async () => {
    const alpha = await toText('<ol class="ol-alpha"><li><p>раз</p></li><li><p>два</p></li></ol>')
    expect(alpha).toMatch(/a\)\s*раз/)
    expect(alpha).toMatch(/b\)\s*два/)

    const roman = await toText('<ol class="ol-roman"><li><p>раз</p></li><li><p>два</p></li></ol>')
    expect(roman).toMatch(/i\)\s*раз/)
    expect(roman).toMatch(/ii\)\s*два/)
  })

  it('обычный <ol> без класса нумеруется как legal (1., 2.)', async () => {
    const text = await toText('<ol><li><p>Альфа</p></li><li><p>Бета</p></li></ol>')
    expect(text).toMatch(/1\.\s*Альфа/)
    expect(text).toMatch(/2\.\s*Бета/)
  })
})
