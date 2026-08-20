// Тесты детерминированного пересчёта таблиц (lib/table-math.ts).
// Защитные тесты после случая, когда ИИ смотрел только на итоговые суммы,
// объявлял таблицу верной, а потом переспрашивал пользователя, где ошибки.
// Арифметику теперь считает код, поэтому ответ должен быть точным всегда.
import { describe, it, expect } from 'vitest'

import { parseRuNumber, formatRuNumber, checkDocumentTables, formatTableMathReport } from '@/lib/table-math'
import { htmlToPlainText } from '@/lib/html-to-text'

describe('parseRuNumber', () => {
  it('целое число без разделителей', () => {
    expect(parseRuNumber('1000')).toBe(1000)
  })

  it('пробел как разделитель тысяч', () => {
    expect(parseRuNumber('1 000')).toBe(1000)
  })

  it('неразрывный пробел (Word ставит его сам) разбирается', () => {
    expect(parseRuNumber('1\u00A0000')).toBe(1000)
    expect(parseRuNumber('1 000\u00A0000')).toBe(1000000)
  })

  it('запятая — дробная часть', () => {
    expect(parseRuNumber('1 000,50')).toBe(1000.5)
  })

  it('валюта и единицы рядом с числом не мешают', () => {
    expect(parseRuNumber('12 500,00 ₽')).toBe(12500)
    expect(parseRuNumber('5 шт.')).toBe(5)
  })

  it('точка как разделитель тысяч в строгом шаблоне', () => {
    expect(parseRuNumber('1.200')).toBe(1200)
  })

  it('точка как дробная часть', () => {
    expect(parseRuNumber('1.2')).toBe(1.2)
    expect(parseRuNumber('1 000.50')).toBe(1000.5)
  })

  it('из двух чисел в ячейке берётся первое (основное)', () => {
    expect(parseRuNumber('12 500,00 (в т.ч. НДС 2 083,33)')).toBe(12500)
  })

  it('текст без цифр → null', () => {
    expect(parseRuNumber('Сумма, руб.')).toBeNull()
    expect(parseRuNumber('')).toBeNull()
    expect(parseRuNumber(null)).toBeNull()
  })
})

describe('formatRuNumber', () => {
  it('печатает число в русском виде', () => {
    expect(formatRuNumber(1234567.5)).toBe('1 234 567,50')
    expect(formatRuNumber(-500)).toBe('-500,00')
  })
})

// ─── HTML-таблицы (так хранится версия документа) ───────────────────────────

function htmlTable(rows: string[][]): string {
  const body = rows
    .map((cells, idx) =>
      '<tr>' + cells.map((c) => (idx === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>',
    )
    .join('')
  return `<p>Приложение № 1</p><table>${body}</table>`
}

const CORRECT_ROWS = [
  ['№', 'Наименование', 'Кол-во', 'Цена, руб.', 'Сумма, руб.'],
  ['1', 'Монтаж узла', '2', '1 000,00', '2 000,00'],
  ['2', 'Пусконаладка', '3', '1 500,50', '4 501,50'],
  ['', 'ИТОГО', '', '', '6 501,50'],
]

describe('checkDocumentTables — HTML', () => {
  it('корректная таблица → расхождений нет', () => {
    const result = checkDocumentTables(htmlTable(CORRECT_ROWS))
    expect(result.tables).toBe(1)
    expect(result.rowsChecked).toBe(2)
    expect(result.issues).toEqual([])
    expect(result.overall).toEqual({ expected: 6501.5, stated: 6501.5, diff: 0 })
  })

  it('ошибка в ячейке суммы строки → расхождение найдено с точными числами', () => {
    const rows = CORRECT_ROWS.map((r) => [...r])
    rows[1]![4] = '2 500,00' // должно быть 2 000,00
    rows[3]![4] = '7 001,50' // итог владелец пересчитал под ошибочную строку

    const result = checkDocumentTables(htmlTable(rows))
    const rowIssues = result.issues.filter((i) => i.kind === 'row')
    expect(rowIssues).toHaveLength(1)
    expect(rowIssues[0]).toMatchObject({
      table: 1,
      row: 1,
      kind: 'row',
      expected: 2000,
      stated: 2500,
      diff: 500,
    })
    expect(rowIssues[0]!.label).toContain('Монтаж узла')
  })

  it('неверное «Итого» при верных строках → найдено именно оно', () => {
    const rows = CORRECT_ROWS.map((r) => [...r])
    rows[3]![4] = '6 000,00' // строки дают 6 501,50

    const result = checkDocumentTables(htmlTable(rows))
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      kind: 'total',
      expected: 6501.5,
      stated: 6000,
      diff: -501.5,
    })
  })

  it('колонка «Коэффициент» участвует в расчёте', () => {
    const rows = [
      ['№', 'Работа', 'Кол-во', 'Цена', 'Коэффициент', 'Сумма'],
      ['1', 'Работы в выходной', '2', '1 000,00', '1,5', '3 000,00'],
      ['2', 'Работы ночью', '2', '1 000,00', '2', '3 000,00'], // должно быть 4 000,00
      ['', 'Итого', '', '', '', '6 000,00'],
    ]
    const result = checkDocumentTables(htmlTable(rows))
    const rowIssues = result.issues.filter((i) => i.kind === 'row')
    expect(rowIssues).toHaveLength(1)
    expect(rowIssues[0]).toMatchObject({ row: 2, expected: 4000, stated: 3000, diff: -1000 })
  })

  it('несколько разделов: каждый «Итого» сверяется со своим блоком, общий — с суммой итогов', () => {
    const rows = [
      ['№', 'Наименование', 'Кол-во', 'Цена', 'Сумма'],
      ['1', 'Раздел 1 позиция', '1', '100,00', '100,00'],
      ['', 'Итого по разделу 1', '', '', '100,00'],
      ['2', 'Раздел 2 позиция', '2', '200,00', '400,00'],
      ['', 'Итого по разделу 2', '', '', '400,00'],
      ['', 'ВСЕГО', '', '', '500,00'],
    ]
    expect(checkDocumentTables(htmlTable(rows)).issues).toEqual([])
  })

  it('документ без таблиц → пустой результат, ничего не падает', () => {
    const result = checkDocumentTables('<p>1. Предмет договора.</p><p>2. Цена договора 100 000 руб.</p>')
    expect(result).toEqual({ tables: 0, rowsChecked: 0, issues: [], overall: null })
    expect(checkDocumentTables('')).toEqual({ tables: 0, rowsChecked: 0, issues: [], overall: null })
  })
})

// ─── Plain text (в чат документ уходит через htmlToPlainText) ───────────────

describe('checkDocumentTables — plain text с табуляцией', () => {
  const text = [
    'ПРИЛОЖЕНИЕ № 1',
    '№\tНаименование\tКол-во\tЦена, руб.\tСумма, руб.',
    '1\tМонтаж узла\t2\t1 000,00\t2 000,00',
    '2\tПусконаладка\t3\t1 500,00\t4 000,00',
    '\tИТОГО\t\t\t6 000,00',
  ].join('\n')

  it('находит ошибку в строке, где Кол-во × Цена ≠ Сумма', () => {
    const result = checkDocumentTables(text)
    expect(result.tables).toBe(1)
    expect(result.rowsChecked).toBe(2)
    const rowIssues = result.issues.filter((i) => i.kind === 'row')
    expect(rowIssues).toHaveLength(1)
    expect(rowIssues[0]).toMatchObject({ row: 2, expected: 4500, stated: 4000, diff: -500 })
  })

  // В чат документ уходит именно через htmlToPlainText — эта функция обрезает
  // крайние пустые ячейки строк, из-за чего колонки могут «съехать».
  // Проверяем на её настоящем выводе, что ложных расхождений не возникает.
  it('на реальном выводе htmlToPlainText верная таблица не даёт ложных расхождений', () => {
    const plain = htmlToPlainText(htmlTable(CORRECT_ROWS))
    const result = checkDocumentTables(plain)
    expect(result.tables).toBe(1)
    expect(result.issues).toEqual([])
  })

  it('на реальном выводе htmlToPlainText ошибка в сумме строки всё равно находится', () => {
    const rows = CORRECT_ROWS.map((r) => [...r])
    rows[1]![4] = '2 500,00'
    rows[3]![4] = '7 001,50'
    const result = checkDocumentTables(htmlToPlainText(htmlTable(rows)))
    const rowIssues = result.issues.filter((i) => i.kind === 'row')
    expect(rowIssues).toHaveLength(1)
    expect(rowIssues[0]).toMatchObject({ expected: 2000, stated: 2500, diff: 500 })
  })
})

describe('formatTableMathReport', () => {
  it('без таблиц — пустая строка (промпт не раздуваем)', () => {
    expect(formatTableMathReport(checkDocumentTables('<p>Текст без таблиц</p>'))).toBe('')
  })

  it('корректная таблица — сообщает, что расхождений нет, и запрещает переспрашивать', () => {
    const report = formatTableMathReport(checkDocumentTables(htmlTable(CORRECT_ROWS)))
    expect(report).toContain('Расхождений нет')
    expect(report).toContain('не переспрашивай пользователя')
  })

  it('расхождение попадает в отчёт в виде «ожидалось → указано»', () => {
    const rows = CORRECT_ROWS.map((r) => [...r])
    rows[1]![4] = '2 500,00'
    const report = formatTableMathReport(checkDocumentTables(htmlTable(rows)))
    expect(report).toContain('ожидалось 2 000,00')
    expect(report).toContain('указано 2 500,00')
    expect(report).toContain('Монтаж узла')
  })
})
