/**
 * Детерминированная проверка арифметики таблиц договора.
 *
 * Почему в коде, а не моделью: арифметика не требует «понимания» — она требует
 * точности. Модель на живом документе смотрела только на итоговые суммы, объявляла
 * их верными, а затем спрашивала у пользователя, где именно ошибки. Пересчёт в коде
 * даёт один и тот же ответ всегда, стоит ноль токенов и не зависит от того, какая
 * модель включена в /admin/ai. Модели остаётся только сформулировать вывод по
 * готовому списку расхождений.
 *
 * Работает и с HTML (версия документа хранится в HTML), и с plain text — в чат
 * документ уходит через htmlToPlainText, где строка таблицы = строка текста,
 * а ячейки разделены табуляцией.
 *
 * Содержимое договора отсюда НИКОГДА не уходит в логи (правило проекта №11):
 * функции возвращают данные вызывающему коду, сами ничего не пишут.
 */

export interface TableMathIssue {
  /** Номер таблицы в документе, с 1 */
  table: number
  /** Порядковый номер строки данных внутри таблицы, с 1 (заголовок не считается) */
  row: number
  /** Краткая подпись строки для человека: номер позиции и/или наименование */
  label: string
  /** row — не сходится Кол-во × Цена × Коэффициент; total — не сходится строка «Итого» */
  kind: 'row' | 'total'
  /** Что должно получиться по расчёту */
  expected: number
  /** Что написано в документе */
  stated: number
  /** stated − expected: положительная разница = в документе завышено */
  diff: number
}

export interface TableMathResult {
  /** Сколько таблиц с распознанными числовыми колонками найдено */
  tables: number
  /** Сколько строк удалось пересчитать (по ним и делаются выводы) */
  rowsChecked: number
  issues: TableMathIssue[]
  /** Общий итог по всем пересчитанным строкам всех таблиц */
  overall: { expected: number; stated: number; diff: number } | null
}

export interface TableMathOptions {
  /**
   * Допустимое отклонение в рублях. По умолчанию копейка: расхождение меньше
   * копейки — это ошибка представления, а не ошибка в документе.
   */
  tolerance?: number
}

// ─── Разбор чисел в русском формате ─────────────────────────────────────────

// Неразрывный, узкий неразрывный и тонкий пробелы: Word расставляет их сам,
// после копирования в браузер они остаются и ломают наивный parseFloat.
const SPACE_CHARS = /[\u00A0\u202F\u2009\u2007]/g

// Единицы и валюта рядом с числом («1 200,50 ₽», «5 шт.»)
const UNIT_NOISE = /(₽|руб\.?|рублей|коп\.?|шт\.?|ед\.?|%|\$|€)/gi

// Число целиком: целая часть, пробелы как разделители тысяч, запятая или точка как дробная часть
const NUMBER_TOKEN = /-?\d+(?: \d{3})*(?:[.,]\d+)?/

/**
 * Разбирает число из ячейки таблицы в русском написании.
 * «1 000» → 1000, «1 000,50» → 1000.5, «12 500,00 ₽» → 12500.
 * Возвращает null, если числа в ячейке нет.
 */
export function parseRuNumber(raw: string | null | undefined): number | null {
  if (!raw) return null

  // Сначала убираем неразрывные пробелы и единицы, но НЕ схлопываем всё подряд:
  // в ячейке может быть два числа («12 500,00 (в т.ч. НДС 2 083,33)») — берём первое,
  // потому что документ читается слева направо и первым идёт основное значение.
  const cleaned = raw.replace(SPACE_CHARS, ' ').replace(UNIT_NOISE, ' ').replace(/\s+/g, ' ')
  const match = cleaned.match(NUMBER_TOKEN)
  if (!match) return null

  let token = match[0].replace(/ /g, '')
  const lastComma = token.lastIndexOf(',')
  const lastDot = token.lastIndexOf('.')

  if (lastComma !== -1 && lastDot !== -1) {
    // Встречаются оба разделителя — дробным считается последний, второй разделял тысячи
    const decimalAt = Math.max(lastComma, lastDot)
    token = token.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + token.slice(decimalAt + 1)
  } else if (lastComma !== -1) {
    // Запятая в русском документе — всегда дробная часть
    token = token.replace(',', '.')
  } else if (lastDot !== -1) {
    // Точка неоднозначна: «1.200» — это тысячи, «1.2» — дробь.
    // Разделителем тысяч считаем только строгий шаблон групп по три цифры.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(token)) token = token.replace(/\./g, '')
  }

  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Формат числа для промпта: «12 500,00» — так же, как оно выглядит в документе */
export function formatRuNumber(value: number): string {
  const fixed = round2(value).toFixed(2)
  const [int = '0', frac = '00'] = fixed.split('.')
  const sign = int.startsWith('-') ? '-' : ''
  const digits = sign ? int.slice(1) : int
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + frac
}

// ─── Разбор таблиц ──────────────────────────────────────────────────────────

type Table = string[][]

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function cellText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(SPACE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Таблицы из HTML. Подход тот же, что у extractTables в gigachat-provider: без DOM. */
function parseHtmlTables(html: string): Table[] {
  const tables: Table[] = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch: RegExpExecArray | null
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const rows: Table = []
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRe.exec(tableMatch[1] ?? '')) !== null) {
      const cells: string[] = []
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellRe.exec(rowMatch[1] ?? '')) !== null) {
        cells.push(cellText(cellMatch[1] ?? ''))
      }
      if (cells.length > 1) rows.push(cells)
    }
    if (rows.length > 1) tables.push(rows)
  }
  return tables
}

function splitPlainRow(line: string): string[] | null {
  if (line.includes('\t')) {
    const cells = line.split('\t').map((c) => c.replace(SPACE_CHARS, ' ').trim())
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    return cells.length > 1 ? cells : null
  }
  if (line.trim().startsWith('|')) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    return cells.length > 1 ? cells : null
  }
  return null
}

/**
 * Таблицы из plain text: подряд идущие строки с табуляцией (так их отдаёт
 * htmlToPlainText) либо pipe-разметка. Одна группа подряд идущих строк = одна таблица.
 */
function parsePlainTables(text: string): Table[] {
  const tables: Table[] = []
  let current: Table = []
  for (const line of text.split('\n')) {
    const cells = splitPlainRow(line)
    if (cells) {
      current.push(cells)
    } else if (current.length > 0) {
      if (current.length > 1) tables.push(current)
      current = []
    }
  }
  if (current.length > 1) tables.push(current)
  return tables
}

// ─── Распознавание колонок ──────────────────────────────────────────────────

interface ColumnMap {
  qty?: number
  price?: number
  coef?: number
  amount?: number
}

// Порядок проверки важен: «Стоимость за единицу» — это цена, а не сумма,
// поэтому цена проверяется раньше суммы.
// Границы слов через lookaround по кириллице, а не \b: в JS \b опирается на
// [A-Za-z0-9_], для русских букв он не срабатывает вообще.
const COEF_RE = /коэф|к-т/i
const QTY_RE = /кол-?во|количеств|(?<![а-яё])шт(?![а-яё])|объ[её]м/i
const PRICE_RE = /цена|тариф|ставка|расценк|стоимость\s*(за|ед|1)/i
const AMOUNT_RE = /сумм|стоимост|итог|всего/i

function classifyHeader(row: string[]): ColumnMap {
  const cols: ColumnMap = {}
  row.forEach((raw, idx) => {
    const cell = raw.toLowerCase()
    if (!cell) return
    if (cols.coef === undefined && COEF_RE.test(cell)) { cols.coef = idx; return }
    if (cols.qty === undefined && QTY_RE.test(cell)) { cols.qty = idx; return }
    if (cols.price === undefined && PRICE_RE.test(cell)) { cols.price = idx; return }
    if (cols.amount === undefined && AMOUNT_RE.test(cell)) { cols.amount = idx; return }
  })
  return cols
}

/**
 * Заголовок ищем в первых строках: в приложениях перед шапкой часто идёт
 * строка с названием раздела.
 */
function findHeader(rows: Table): { index: number; cols: ColumnMap } | null {
  const limit = Math.min(rows.length, 5)
  for (let i = 0; i < limit; i++) {
    const row = rows[i]
    if (!row) continue
    const cols = classifyHeader(row)
    if (cols.amount === undefined) continue
    // Защита от того, чтобы принять строку данных за заголовок: в ячейке
    // заголовка суммы не бывает самой суммы.
    if (parseRuNumber(row[cols.amount]) !== null) continue
    return { index: i, cols }
  }
  return null
}

// Тот же нюанс с \b: строка итога опознаётся по началу ячейки и по тому, что
// дальше не идёт продолжение слова («итоговый» — не итог).
const TOTAL_RE = /^\s*(итого|итог|всего|сумма\s+по)(?![а-яё])/i

function isTotalRow(row: string[]): boolean {
  return row.some((cell) => TOTAL_RE.test(cell))
}

function rowLabel(row: string[], cols: ColumnMap, fallbackIndex: number): string {
  const numericCols = new Set([cols.qty, cols.price, cols.coef, cols.amount])
  const parts: string[] = []
  row.forEach((cell, idx) => {
    if (numericCols.has(idx)) return
    if (!cell) return
    if (/^\d+[.)]?$/.test(cell)) {
      if (parts.length === 0) parts.push(`№${cell}`)
      return
    }
    if (parts.length < 2 && /[А-Яа-яA-Za-z]/.test(cell)) parts.push(cell)
  })
  const label = parts.join(' ').trim()
  if (!label) return `строка ${fallbackIndex}`
  return label.length > 60 ? `${label.slice(0, 57)}…` : label
}

/** Значение суммы строки: из колонки суммы, иначе — последнее число в строке */
function amountOf(row: string[], amountCol: number | undefined): number | null {
  if (amountCol !== undefined) {
    const direct = parseRuNumber(row[amountCol])
    if (direct !== null) return direct
  }
  for (let i = row.length - 1; i >= 0; i--) {
    const value = parseRuNumber(row[i])
    if (value !== null) return value
  }
  return null
}

// ─── Основная проверка ──────────────────────────────────────────────────────

/**
 * Пересчитывает все таблицы документа и возвращает список расхождений.
 * Ничего не бросает: документ может быть любым, а проверка — вспомогательная.
 */
export function checkDocumentTables(source: string, options: TableMathOptions = {}): TableMathResult {
  const tolerance = options.tolerance ?? 0.01
  const empty: TableMathResult = { tables: 0, rowsChecked: 0, issues: [], overall: null }
  if (!source || !source.trim()) return empty

  let parsed: Table[]
  try {
    parsed = /<t[dr][\s>]|<table[\s>]/i.test(source) ? parseHtmlTables(source) : parsePlainTables(source)
  } catch {
    return empty
  }
  if (parsed.length === 0) return empty

  const issues: TableMathIssue[] = []
  let tables = 0
  let rowsChecked = 0
  let overallExpected = 0
  let overallStated = 0

  parsed.forEach((rows) => {
    const header = findHeader(rows)
    if (!header) return
    tables += 1
    const tableNo = tables
    const { cols } = header
    const headerWidth = rows[header.index]?.length ?? 0

    // htmlToPlainText схлопывает перенос перед строкой, которая начинается с
    // пустой ячейки (строка «Итого» без номера позиции) — две строки таблицы
    // склеиваются в одну. Разбираем такую склейку обратно по ширине шапки,
    // иначе итог теряется, а его число попадает в чужую строку.
    const dataRows: string[][] = []
    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      if (headerWidth > 1 && row.length > headerWidth && row.length % headerWidth === 0) {
        for (let k = 0; k < row.length; k += headerWidth) dataRows.push(row.slice(k, k + headerWidth))
      } else {
        dataRows.push(row)
      }
    }

    // Итоги считаем по разделам: строка «Итого» закрывает свой блок строк.
    // Так устроены приложения — несколько разделов и общий итог в конце.
    let sectionStated = 0
    let sectionRows = 0
    const sectionTotals: number[] = []
    let dataRowNo = 0

    for (const row of dataRows) {

      if (isTotalRow(row)) {
        const stated = amountOf(row, cols.amount)
        if (stated === null) continue
        const bySection = round2(sectionStated)
        const byTotals = round2(sectionTotals.reduce((a, b) => a + b, 0))
        // Последняя строка «Итого» в таблице может быть общим итогом — тогда она
        // сходится не со своим блоком строк, а с суммой предыдущих итогов.
        const matches =
          (sectionRows > 0 && Math.abs(stated - bySection) <= tolerance) ||
          (sectionTotals.length > 0 && Math.abs(stated - byTotals) <= tolerance)
        if (!matches && (sectionRows > 0 || sectionTotals.length > 0)) {
          const expected = sectionRows > 0 ? bySection : byTotals
          issues.push({
            table: tableNo,
            row: dataRowNo,
            label: rowLabel(row, cols, dataRowNo) || 'Итого',
            kind: 'total',
            expected,
            stated,
            diff: round2(stated - expected),
          })
        }
        sectionTotals.push(stated)
        sectionStated = 0
        sectionRows = 0
        continue
      }

      // Строку с другим числом ячеек пропускаем: колонки в ней не совпадают с
      // шапкой (объединённые ячейки, а в plain text — обрезанные пустые крайние
      // ячейки), и «сумма» прочиталась бы из чужой колонки. Лучше не проверить
      // строку, чем сообщить о несуществующей ошибке.
      if (row.length !== headerWidth) continue

      const stated = cols.amount === undefined ? null : parseRuNumber(row[cols.amount])
      if (stated === null) continue // строка-подзаголовок раздела или пустая

      dataRowNo += 1
      sectionStated += stated
      sectionRows += 1

      const qty = cols.qty === undefined ? null : parseRuNumber(row[cols.qty])
      const price = cols.price === undefined ? null : parseRuNumber(row[cols.price])
      if (qty === null || price === null) continue

      // Коэффициент необязателен: если колонки нет или ячейка пуста — множитель 1
      const coef = cols.coef === undefined ? null : parseRuNumber(row[cols.coef])
      const expected = round2(qty * price * (coef ?? 1))

      rowsChecked += 1
      overallExpected += expected
      overallStated += stated

      if (Math.abs(stated - expected) > tolerance) {
        issues.push({
          table: tableNo,
          row: dataRowNo,
          label: rowLabel(row, cols, dataRowNo),
          kind: 'row',
          expected,
          stated,
          diff: round2(stated - expected),
        })
      }
    }
  })

  return {
    tables,
    rowsChecked,
    issues,
    overall:
      rowsChecked > 0
        ? {
            expected: round2(overallExpected),
            stated: round2(overallStated),
            diff: round2(overallStated - overallExpected),
          }
        : null,
  }
}

/**
 * Готовый блок для системного промпта. Пустая строка — значит считать нечего
 * и промпт раздувать незачем.
 *
 * Расхождения подаются модели как ФАКТЫ: пересчёт уже сделан, спорить с ним
 * или пересчитывать заново не надо — иначе модель начинает сомневаться в
 * собственных выводах и переспрашивать пользователя.
 */
export function formatTableMathReport(result: TableMathResult): string {
  if (result.tables === 0 || result.rowsChecked === 0) return ''

  const lines = [
    '══════════ ПРОВЕРЕННЫЕ РАСЧЁТЫ (посчитано программой, это факты) ══════════',
    `Пересчитано строк: ${result.rowsChecked} в ${result.tables} табл.`,
  ]

  if (result.issues.length === 0) {
    lines.push('Расхождений нет: каждая строка сходится (Кол-во × Цена × Коэффициент), итоги совпадают с суммой строк.')
    lines.push('Не выдумывай арифметические ошибки там, где их нет, и не переспрашивай пользователя.')
    return lines.join('\n')
  }

  lines.push(`Найдено расхождений: ${result.issues.length}. Перечисли их пользователю все, ничего не добавляя от себя:`)
  for (const issue of result.issues) {
    const where = issue.kind === 'total' ? 'итог' : 'строка'
    lines.push(
      `- табл. ${issue.table}, ${where} ${issue.row} («${issue.label}»): ожидалось ${formatRuNumber(issue.expected)} — указано ${formatRuNumber(issue.stated)}, разница ${issue.diff > 0 ? '+' : ''}${formatRuNumber(issue.diff)}`,
    )
  }
  if (result.overall) {
    lines.push(
      `Общий итог по пересчитанным строкам: ожидалось ${formatRuNumber(result.overall.expected)}, указано ${formatRuNumber(result.overall.stated)}, разница ${result.overall.diff > 0 ? '+' : ''}${formatRuNumber(result.overall.diff)}.`,
    )
  }
  lines.push('Числа бери отсюда дословно. Не переписывай таблицу целиком — только строки с расхождениями.')
  return lines.join('\n')
}
