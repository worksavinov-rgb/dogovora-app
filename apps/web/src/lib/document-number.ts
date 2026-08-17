// Нумерация договоров по юрлицам.
//
// Формат номера задаётся пользователем в карточке своего юрлица как шаблон
// с плейсхолдерами, например "{NNN}/{ММ}-{ГГ}" → "005/08-26".
//
// Счётчик нигде не хранится. Следующий номер вычисляется обратным разбором
// уже существующих номеров: шаблон превращается в regex, где плейсхолдеры даты
// зафиксированы текущим периодом, а счётчик — capture-группа. Из совпавших
// номеров берётся максимум и увеличивается на единицу.
//
// Такой подход самовосстанавливается: пользователь может вписать номер руками,
// отменить создание документа или поменять шаблон — система всё равно продолжит
// с фактического максимума, потому что состояние = сами документы.
//
// Модуль чистый: без Prisma, без React, без сети. Только строки и даты.

/** Область, внутри которой счётчик начинается заново. Выводится из шаблона. */
export type NumberScope = 'month' | 'year' | 'global'

export type FormatErrorCode = 'EMPTY' | 'NO_COUNTER' | 'MANY_COUNTERS' | 'UNKNOWN_TOKEN'

export interface FormatError {
  code: FormatErrorCode
  message: string
  /** Плейсхолдер, из-за которого ошибка (для UNKNOWN_TOKEN). */
  token?: string
}

type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'counter'; width: number }
  | { kind: 'year4' }
  | { kind: 'year2' }
  | { kind: 'month' }

/** Плейсхолдеры в каноническом (кириллическом) виде — для подсказки в UI. */
export const PLACEHOLDER_HINTS: Array<{ token: string; label: string }> = [
  { token: '{N}', label: 'счётчик: 5' },
  { token: '{NN}', label: 'счётчик, 2 знака: 05' },
  { token: '{NNN}', label: 'счётчик, 3 знака: 005' },
  { token: '{ГГГГ}', label: 'год: 2026' },
  { token: '{ГГ}', label: 'год, 2 цифры: 26' },
  { token: '{ММ}', label: 'месяц: 08' },
]

/**
 * Приводит шаблон к каноническому виду: латинские алиасы → кириллица,
 * регистр плейсхолдеров → верхний.
 *
 * Кириллическая «М» и латинская «M» неразличимы на глаз, поэтому принимать
 * только один вариант — значит гарантированно ловить жалобы «формат не
 * сохраняется». Всё, что вне фигурных скобок, не трогаем.
 */
export function normalizeFormat(tpl: string): string {
  return tpl.replace(/\{([^}]*)\}/g, (whole, inner: string) => {
    const up = inner.toUpperCase()
    if (/^[NН]+$/.test(up)) return `{${'N'.repeat(up.length)}}`
    if (up === 'YYYY' || up === 'ГГГГ') return '{ГГГГ}'
    if (up === 'YY' || up === 'ГГ') return '{ГГ}'
    if (up === 'MM' || up === 'ММ') return '{ММ}'
    return whole
  })
}

function tokenize(tpl: string): { tokens: Token[]; unknown: string[] } {
  const tokens: Token[] = []
  const unknown: string[] = []
  const re = /\{[^}]*\}/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) tokens.push({ kind: 'literal', text: tpl.slice(last, m.index) })
    const t = m[0]
    if (/^\{N+\}$/.test(t)) tokens.push({ kind: 'counter', width: t.length - 2 })
    else if (t === '{ГГГГ}') tokens.push({ kind: 'year4' })
    else if (t === '{ГГ}') tokens.push({ kind: 'year2' })
    else if (t === '{ММ}') tokens.push({ kind: 'month' })
    else {
      unknown.push(t)
      tokens.push({ kind: 'literal', text: t })
    }
    last = m.index + t.length
  }
  if (last < tpl.length) tokens.push({ kind: 'literal', text: tpl.slice(last) })

  return { tokens, unknown }
}

/**
 * Проверяет шаблон. Возвращает null, если он корректен.
 *
 * Неизвестный плейсхолдер — именно ошибка, а не «оставим как есть»: иначе
 * пользователь получит договор с номером «{ГОД}/08» и заметит это уже в Word.
 */
export function validateFormat(tpl: string): FormatError | null {
  const normalized = normalizeFormat(tpl).trim()
  if (!normalized) {
    return { code: 'EMPTY', message: 'Шаблон пустой' }
  }

  const { tokens, unknown } = tokenize(normalized)
  if (unknown.length > 0) {
    return {
      code: 'UNKNOWN_TOKEN',
      message: `Неизвестный плейсхолдер ${unknown[0]}. Доступны: {N}, {NN}, {NNN}, {ГГГГ}, {ГГ}, {ММ}`,
      token: unknown[0],
    }
  }

  const counters = tokens.filter((t) => t.kind === 'counter').length
  if (counters === 0) {
    return { code: 'NO_COUNTER', message: 'В шаблоне нет счётчика — добавьте {N}, {NN} или {NNN}' }
  }
  if (counters > 1) {
    return { code: 'MANY_COUNTERS', message: 'В шаблоне больше одного счётчика — оставьте только один' }
  }

  return null
}

/**
 * Область сброса счётчика выводится из самого шаблона.
 *
 * Отдельной настройки «сброс» намеренно нет: комбинация «шаблон без года +
 * ежегодный сброс» породила бы одинаковые номера в разные годы.
 */
export function formatScope(tpl: string): NumberScope {
  const { tokens } = tokenize(normalizeFormat(tpl))
  if (tokens.some((t) => t.kind === 'month')) return 'month'
  if (tokens.some((t) => t.kind === 'year2' || t.kind === 'year4')) return 'year'
  return 'global'
}

export const SCOPE_LABELS: Record<NumberScope, string> = {
  month: 'счёт начинается заново каждый месяц',
  year: 'счёт начинается заново каждый год',
  global: 'сквозная нумерация без сброса',
}

function yearOf(date: Date): string {
  return String(date.getFullYear())
}

function monthOf(date: Date): string {
  return String(date.getMonth() + 1).padStart(2, '0')
}

/** Подставляет в шаблон конкретный порядковый номер и период. */
export function renderNumber(tpl: string, seq: number, date: Date): string {
  const { tokens } = tokenize(normalizeFormat(tpl))
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'literal':
          return t.text
        case 'counter':
          return String(seq).padStart(t.width, '0')
        case 'year4':
          return yearOf(date)
        case 'year2':
          return yearOf(date).slice(-2)
        case 'month':
          return monthOf(date)
      }
    })
    .join('')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Строит regex, который узнаёт номера этого шаблона за конкретный период.
 * Дата зафиксирована, счётчик — capture-группа 1.
 *
 * Флаг `g` не ставим намеренно: RegExp с `g` хранит lastIndex между вызовами
 * exec, и переиспользование такого объекта в цикле давало бы пропуски.
 */
export function buildMatcher(tpl: string, date: Date): RegExp {
  const { tokens } = tokenize(normalizeFormat(tpl))
  const body = tokens
    .map((t) => {
      switch (t.kind) {
        case 'literal':
          return escapeRegExp(t.text)
        case 'counter':
          return '(\\d+)'
        case 'year4':
          return escapeRegExp(yearOf(date))
        case 'year2':
          return escapeRegExp(yearOf(date).slice(-2))
        case 'month':
          return escapeRegExp(monthOf(date))
      }
    })
    .join('')
  return new RegExp(`^${body}$`)
}

/**
 * Следующий свободный номер: максимум среди подходящих существующих + 1.
 *
 * Номера, не подходящие под шаблон текущего периода, игнорируются — это и есть
 * механизм сброса: в сентябре номера с «/08-» просто перестают совпадать.
 */
export function nextNumber(
  tpl: string,
  existing: Array<string | null | undefined>,
  date: Date,
): string {
  const re = buildMatcher(tpl, date)
  let max = 0
  for (const raw of existing) {
    if (!raw) continue
    const m = re.exec(raw.trim())
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = n
  }
  return renderNumber(tpl, max + 1, date)
}

/**
 * Разбирает дату вида "2026-08-17" в локальную Date без сдвига часового пояса.
 *
 * new Date("2026-08-01") трактуется как UTC-полночь, и в отрицательных
 * смещениях это даёт 31 июля — то есть номер за прошлый месяц. Поэтому парсим
 * строку сами.
 */
export function periodFromDateString(value?: string | null): Date {
  if (value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  return new Date()
}
