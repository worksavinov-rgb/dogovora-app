// Перевод HTML документа в plain text для ИИ.
// Ключевой случай: строка таблицы, начинающаяся с ПУСТОЙ ячейки (типичная строка
// «ИТОГО» без номера) не должна приклеиваться к предыдущей строке — иначе модель
// получает таблицу с потерянной структурой.
import { describe, it, expect } from 'vitest'
import { htmlToPlainText } from '@/lib/html-to-text'

const rows = (html: string) => htmlToPlainText(html).split('\n').filter((l) => l.trim())

describe('htmlToPlainText: таблицы', () => {
  it('строка с пустой первой ячейкой остаётся отдельной строкой', () => {
    const html = [
      '<table><tbody>',
      '<tr><td>1</td><td>Монитор LG27</td><td>1</td><td>700</td></tr>',
      '<tr><td></td><td>Итого</td><td></td><td>700</td></tr>',
      '</tbody></table>',
    ].join('')

    const lines = rows(html)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Монитор LG27')
    expect(lines[1]).toContain('Итого')
    // Итоговая строка не должна оказаться внутри строки с монитором
    expect(lines[0]).not.toContain('Итого')
  })

  it('абзац внутри ячейки не разрывает строку таблицы', () => {
    const html = [
      '<table><tbody>',
      '<tr><td><p>1</p></td><td><p>Услуга</p></td><td><p>500</p></td></tr>',
      '<tr><td><p>2</p></td><td><p>Ещё услуга</p></td><td><p>300</p></td></tr>',
      '</tbody></table>',
    ].join('')

    const lines = rows(html)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Услуга')
    expect(lines[1]).toContain('Ещё услуга')
  })

  it('колонки разделены табуляцией', () => {
    const html = '<table><tbody><tr><td>А</td><td>Б</td></tr></tbody></table>'
    expect(rows(html)[0]!.split('\t').filter(Boolean)).toEqual(['А', 'Б'])
  })

  it('несколько подряд идущих строк с пустой первой ячейкой не сливаются', () => {
    const html = [
      '<table><tbody>',
      '<tr><td>1</td><td>Работа</td><td>100</td></tr>',
      '<tr><td></td><td>Итого по разделу</td><td>100</td></tr>',
      '<tr><td></td><td>Всего</td><td>100</td></tr>',
      '</tbody></table>',
    ].join('')

    const lines = rows(html)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Итого по разделу')
    expect(lines[2]).toContain('Всего')
  })
})

describe('htmlToPlainText: обычный текст', () => {
  it('абзацы и заголовки разделяются переносами', () => {
    const out = htmlToPlainText('<h2>ПРЕДМЕТ</h2><p>Первый абзац.</p><p>Второй абзац.</p>')
    expect(out).toContain('ПРЕДМЕТ')
    expect(rows(out)).toEqual(['ПРЕДМЕТ', 'Первый абзац.', 'Второй абзац.'])
  })

  it('элементы списка получают маркер', () => {
    expect(htmlToPlainText('<ul><li>Первый</li><li>Второй</li></ul>')).toContain('• Первый')
  })

  it('декодирует HTML-энтити', () => {
    expect(htmlToPlainText('<p>ООО &quot;Ромашка&quot; &amp; Ко</p>')).toBe('ООО "Ромашка" & Ко')
  })
})
