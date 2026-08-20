/**
 * html-document.ts
 * Утилиты для работы с HTML как единым форматом хранения юридических документов.
 *
 * Основные функции:
 *  - sanitizeHtml()       — удаляет опасные теги, inline-стили, скрипты
 *  - normalizeLegalHtml() — нормализует структуру юридического договора
 *  - markdownToLegalHtml()— миграция старых Markdown-документов → HTML
 *  - buildRequisitesHtml()— генерирует HTML-блок реквизитов сторон
 *  - isHtmlContent()      — определяет, является ли строка HTML
 */

// ─── Разрешённые теги и атрибуты ─────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4',
  'p', 'br',
  'strong', 'b', 'em', 'i',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span',
  'mark', // жёлтое выделение из редактора (TipTap Highlight)
  'blockquote',
  'hr',
])

// Атрибуты разрешены только эти (без inline-стилей, без event handlers)
const ALLOWED_ATTRS = new Set(['class', 'colspan', 'rowspan', 'scope'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Определяет, является ли строка HTML-контентом */
export function isHtmlContent(text: string): boolean {
  return /<(p|h[1-6]|table|div|ul|ol|strong|em|br)\b/i.test(text.slice(0, 2000))
}

/** Определяет, является ли строка Markdown-контентом (содержит маркеры MD) */
export function isMarkdownContent(text: string): boolean {
  if (isHtmlContent(text)) return false
  return /(\*\*[^*]+\*\*|#{1,4}\s|%%REQS_TABLE%%|\n\d+\.\d+\.)/.test(text)
}

// ─── sanitizeHtml ─────────────────────────────────────────────────────────────

/**
 * Удаляет опасные теги (script, style, iframe и т.д.),
 * inline-стили и event-атрибуты (onXxx).
 * Работает в Node.js без DOM через regex.
 */
/** Разрешённый цвет: #rgb/#rrggbb, rgb()/rgba() или имя из букв (red, yellow). */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i

/**
 * Оставляет в инлайновом style только безопасные цветовые свойства
 * (color, background-color) с литеральным значением цвета. Всё остальное —
 * включая url(), expression(), позиционирование и любые скрипты — отбрасывается.
 * Возвращает '' если ничего безопасного не осталось.
 */
export function sanitizeStyleAttr(style: string): string {
  if (!style || /[<>]/.test(style)) return ''
  const kept: string[] = []
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (prop !== 'color' && prop !== 'background-color') continue
    if (!SAFE_COLOR.test(value)) continue
    kept.push(`${prop}: ${value}`)
  }
  return kept.join('; ')
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''

  let result = html

  // Удаляем опасные блоки целиком
  result = result
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '') // HTML-комментарии

  // Удаляем markdown-блоки кода (```html ... ```)
  result = result.replace(/```[\w\s]*\n?([\s\S]*?)```/g, '$1')

  // Удаляем inline style и event handlers из тегов
  result = result.replace(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)\s*>/g, (match, tag, attrs) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) {
      // Нераспознанный тег — сохраняем только разрешённые
      return match
    }
    if (!attrs) return `<${tag}>`

    // Удаляем event handlers, оставляем разрешённые атрибуты. Инлайновый style
    // не выбрасываем целиком, а фильтруем: пользователь помечает пункты цветом
    // шрифта и жёлтой заливкой прямо в редакторе, и эти пометки должны пережить
    // сохранение и выгрузку в DOCX. Пропускаем только color/background-color с
    // литеральным цветом — ни url(), ни expression(), ни position/display.
    const cleanAttrs = attrs
      .replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_m: string, dq?: string, sq?: string) => {
        const safe = sanitizeStyleAttr(dq ?? sq ?? '')
        return safe ? ` style="${safe}"` : ''
      })
      // style без кавычек не разбираем — просто выбрасываем
      .replace(/\s+style\s*=\s*[^\s>"']+/gi, '')
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
      .trim()

    return `<${tag}${cleanAttrs ? ' ' + cleanAttrs : ''}>`
  })

  return result
}

// ─── normalizeLegalHtml ───────────────────────────────────────────────────────

/**
 * Нормализует HTML юридического договора:
 * - удаляет пустые абзацы (более 2 подряд)
 * - убирает markdown-символы которые могли проникнуть в текст
 * - оборачивает одиночные строки с нумерацией в <p> если они не обёрнуты
 * - убирает лишние пробелы
 */
export function normalizeLegalHtml(html: string): string {
  if (!html) return ''

  let result = html

  // Убираем ```html и ``` блоки если AI вернул их
  result = result
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim()

  // Защищаем содержимое таблиц от regex-замен ниже:
  // символы * и нумерация внутри ячеек не должны превращаться в <em>/<p>
  const protectedTables: string[] = []
  result = result.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    protectedTables.push(table)
    return `@@TBL${protectedTables.length - 1}@@`
  })

  // Убираем markdown-разметку которая могла просочиться
  // **жирный** → <strong>жирный</strong>
  result = result.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  // *курсив* → <em>курсив</em>
  result = result.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')

  // Убираем markdown # заголовки если они оказались в тексте (не в тегах)
  result = result.replace(/^#{1,4}\s+(.+)$/gm, (_, text) => {
    // Только если это не уже в HTML теге
    return `<h2>${text.trim()}</h2>`
  })

  // Если строки начинаются с числовых паттернов и не обёрнуты в теги — оборачиваем в <p>
  // Пример: "1.1. Исполнитель обязуется..." → <p>1.1. Исполнитель обязуется...</p>
  // Но только если строка не уже внутри тега
  result = result.replace(/^(\d+\.\d+(?:\.\d+)?\.?\s+.{10,})$/gm, (line) => {
    // Не трогаем строки которые уже в HTML
    const trimmed = line.trim()
    if (trimmed.startsWith('<')) return line
    return `<p>${trimmed}</p>`
  })

  // Схлопываем более 2 пустых <p></p> подряд
  result = result
    .replace(/(<p>\s*<\/p>\s*){3,}/g, '<p></p><p></p>')
    .replace(/(<br\s*\/?>\s*){3,}/g, '<br>')

  // Убираем пустые строки между тегами (оставляем одну)
  result = result.replace(/>\s*\n\s*\n\s*\n/g, '>\n\n')

  // Восстанавливаем защищённые таблицы
  result = result.replace(/(?:<p>\s*)?@@TBL(\d+)@@(?:\s*<\/p>)?/g, (_, idx) => protectedTables[Number(idx)] ?? '')

  return result.trim()
}

/**
 * Распознаёт заголовки в HTML, полученном из загруженного Word (mammoth), где
 * разделы часто приходят обычными жирными абзацами (`<p><strong>…</strong></p>`),
 * а не тегами заголовков — из-за чего в предпросмотре выглядят «сухо». Приводит их
 * к <h1> (название документа) / <h2> (разделы), чтобы применились единые стили
 * оформления (центрирование, разрядка) — как у сгенерированных с нуля документов.
 * Чистая строковая функция (без DOM) — работает и на клиенте, и на сервере, тестируема.
 */
// Строки, которые точно НЕ заголовки разделов (подписи, ФИО, названия сторон,
// реквизиты, поля-заполнители). Используется и эвристикой, и отбором кандидатов для ИИ.
function isNonHeadingLine(text: string): boolean {
  return /_{3,}/.test(text)                                                   // прочерки-заполнители
    || !/[А-ЯЁA-Za-zа-яё]{2,}/.test(text)                                     // нет слов из букв → цена/число («328,00 ₽»), не заголовок
    || /(ИНН|КПП|ОГРН|БИК|р\/сч|к\/сч)/i.test(text)                           // реквизиты
    || /^(заказчик|исполнитель|поставщик|подрядчик|покупатель|продавец|арендатор|арендодатель|банк|адрес|телефон|тел|e-?mail|наименование|юридический адрес|фактический адрес)\s*:/i.test(text) // строка «метка: значение» из реквизитов
    || /^(ИП|ООО|ОАО|АО|ПАО|ЗАО|АНО|НКО|ФГУП|МУП|ГУП|ТСЖ)\s/i.test(text)      // название стороны: «ИП Савинов …»
    || /^(генеральный|исполнительный|финансовый|коммерческий|технический)\s+директор$|^директор$|^индивидуальный предприниматель$/i.test(text) // должность в подписи
    || /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?$/.test(text)                    // «Камолов Б.Ш.»
    || /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+$/.test(text)           // ФИО три слова
}

// Прячет таблицы за плейсхолдерами (внутри таблиц ничего не делаем заголовком —
// это данные/спецификации/цены). Возврат — маскированный HTML + список таблиц.
export function maskTables(html: string): { masked: string; tables: string[] } {
  const tables: string[] = []
  const masked = html.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    tables.push(m)
    return `@@TBLH${tables.length - 1}@@`
  })
  return { masked, tables }
}
export function restoreTables(html: string, tables: string[]): string {
  return html.replace(/@@TBLH(\d+)@@/g, (_m, i: string) => tables[Number(i)] ?? '')
}

export function promoteHeadings(html: string, opts: { conservative?: boolean } = {}): string {
  if (!html) return ''
  // conservative=true — помечаем только ОДНОЗНАЧНЫЕ заголовки (название, номерные
  // разделы, заголовки-списком). Неоднозначные (жирные/заглавные строки) НЕ трогаем —
  // их отдаём на решение ИИ. Так эвристика не «переразмечает» встроенные формы.
  const conservative = opts.conservative === true
  // Таблицы не трогаем — их ячейки не должны становиться заголовками.
  const masked = maskTables(html)
  const tables = masked.tables
  let titleAssigned = false
  let idx = 0
  html = masked.masked

  // Заголовки, которые Word пронумеровал списком (mammoth → <ol><li>Заголовок</li></ol>).
  // Одиночный короткий пункт-заголовок без завершающей пунктуации → <h2>.
  html = html.replace(/<ol\b[^>]*>\s*<li\b[^>]*>([\s\S]*?)<\/li>\s*<\/ol>/gi, (full, inner: string) => {
    if (/<(ol|ul|p|table)\b/i.test(inner)) return full // вложенные списки/блоки — это настоящий список
    const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (text.length >= 3 && text.length <= 60 && !/[.:;]$/.test(text) && /^[А-ЯЁA-Z0-9]/.test(text) && !/^\d+\.\d/.test(text)) {
      return `<h2>${text}</h2>`
    }
    return full
  })

  html = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
    idx++
    const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return full
    const len = text.length
    // Абзац целиком жирный (mammoth: <p><strong>Заголовок</strong></p>)
    const fullyBold = /^<(?:strong|b)>[\s\S]*<\/(?:strong|b)>$/i.test(inner.trim())

    // 1) Название документа → h1 (в первых блоках, короткое, без «в лице/именуемый»)
    // NB: \b не работает с кириллицей в JS-regex — используем lookahead на пробел/№/конец.
    if (!titleAssigned && idx <= 4 && len <= 80 &&
        /^(договор|дополнительное соглашение|доп\.?\s*соглашение|приложение|соглашение)(?=\s|№|$)/i.test(text) &&
        !/в лице|именуем|действующ/i.test(text)) {
      titleAssigned = true
      return `<h1>${text}</h1>`
    }

    // Исключения — точно не заголовки разделов:
    if (len < 3 || len > 80) return full
    if (/^г\.\s/i.test(text)) return full                                   // город
    if (/«___»|«\d|20\d\d\s*г\.?$|\d{1,2}\.\d{1,2}\.20\d\d/.test(text)) return full // дата
    if (/(ИНН|КПП|ОГРН|БИК|р\/сч|к\/сч|расч[её]тный сч|корр[.\s])/i.test(text)) return full // реквизиты (не ловим «расчётов»)
    if (/:$/.test(text)) return full                                        // «Исполнитель вправе:»
    if (/^\d+\.\d/.test(text)) return full                                  // подпункт 1.1 / 2.1.3
    if (isNonHeadingLine(text)) return full                                 // подписи/ФИО/названия сторон/реквизиты

    // Начало приложения/допсоглашения внутри документа — заголовок части
    // («Приложение № 1», «Дополнительное соглашение № 2»). В Word такие части
    // ещё и переносятся на новую страницу (см. html-docx-converter).
    if (/^(приложение|дополнительное\s+соглашение|доп\.?\s*соглашение)\s*(№|N)?\s*\d/i.test(text)) {
      return `<h2>${text}</h2>`
    }

    // Однозначный заголовок: номерной раздел («1. ПРЕДМЕТ …» / «4.Стоимость»).
    const numbered = /^\d{1,2}[.)]\s*[А-ЯЁA-Z]/.test(text)
    if (numbered) return `<h2>${text}</h2>`
    // В консервативном режиме неоднозначные строки не трогаем — решит ИИ.
    if (conservative) return full
    const allCaps = /[А-ЯЁA-Z]/.test(text) && text === text.toUpperCase() && !/[a-zа-яё]/.test(text)
    const boldNoun = fullyBold && !/[.]$/.test(text)                        // жирная короткая строка без точки
    if (allCaps || boldNoun) return `<h2>${text}</h2>`
    return full
  })

  return restoreTables(html, tables)
}

// Маркер стороны в блоке реквизитов: отдельный абзац «Заказчик:» / «Исполнитель:».
const PARTY_MARKER_RE = /^(заказчик|исполнитель|поставщик|подрядчик|покупатель|продавец|арендатор|арендодатель|клиент|агент|принципал)\s*:?\s*$/i
// Признаки того, что это действительно реквизиты, а не просто слово «Заказчик:».
const REQ_SIGNAL_RE = /(ИНН|КПП|ОГРН|ОГРНИП|БИК|р\/сч|к\/сч|счёт|счет|адрес|банк)/i

/**
 * Группирует блок реквизитов сторон в две колонки.
 * Во многих загруженных документах реквизиты идут простыми абзацами подряд
 * («Заказчик:» … «Исполнитель:» …) — в Word это выглядит одним столбиком.
 * Оборачиваем такие пары в `doc-layout-table` с двумя ячейками: предпросмотр
 * (CSS grid) и Word (2-колоночная таблица) рисуют их рядом.
 * Текст не меняется — только группировка блоков.
 */
export function groupRequisitesColumns(html: string): string {
  if (!html || /doc-layout-table|doc-requisites/i.test(html)) return html

  type Blk = { start: number; end: number; tag: string; text: string }
  const blocks: Blk[] = []
  const re = /<(p|h[1-4]|table|div|ul|ol)\b[^>]*>[\s\S]*?<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const text = m[0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    blocks.push({ start: m.index, end: m.index + m[0].length, tag: m[1].toLowerCase(), text })
  }

  const edits: { start: number; end: number; html: string }[] = []
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i]
    if (a.tag !== 'p' || !PARTY_MARKER_RE.test(a.text)) continue
    const partyA = a.text.replace(/[:\s]/g, '').toLowerCase()

    // Ищем маркер ВТОРОЙ стороны — только через абзацы (без заголовков/таблиц между).
    let j = -1
    for (let k = i + 1; k < blocks.length; k++) {
      if (blocks[k].tag !== 'p') break
      const t = blocks[k].text
      if (PARTY_MARKER_RE.test(t) && t.replace(/[:\s]/g, '').toLowerCase() !== partyA) { j = k; break }
    }
    if (j < 0) continue

    // Конец второй колонки — до заголовка/таблицы или до конца документа.
    let end = j
    while (end + 1 < blocks.length && blocks[end + 1].tag === 'p') end++

    const colA = blocks.slice(i, j)
    const colB = blocks.slice(j, end + 1)
    const allText = [...colA, ...colB].map((b) => b.text).join(' ')
    // Требуем реальных признаков реквизитов — иначе это не блок реквизитов.
    if ((allText.match(REQ_SIGNAL_RE) || []).length === 0 || !/ИНН|ОГРН|БИК|счёт|счет/i.test(allText)) continue

    const cell = (arr: Blk[]) => `<div class="doc-layout-cell">${html.slice(arr[0].start, arr[arr.length - 1].end)}</div>`
    edits.push({
      start: colA[0].start,
      end: colB[colB.length - 1].end,
      html: `<div class="doc-layout-table">${cell(colA)}${cell(colB)}</div>`,
    })
    i = end // продолжаем после обработанного блока
  }

  if (!edits.length) return html
  let out = ''
  let pos = 0
  for (const e of edits) {
    out += html.slice(pos, e.start) + e.html
    pos = e.end
  }
  return out + html.slice(pos)
}

/**
 * Превращает блок реквизитов `div.doc-layout-table` в настоящую <table> с одной
 * строкой и двумя ячейками.
 * Зачем: предпросмотр рендерится через TipTap, а его схема не знает тега <div> —
 * такие блоки разворачивались в один столбик. Таблицы TipTap сохраняет, поэтому
 * для показа переводим блок в таблицу (в Word и так 2 колонки).
 */
// ─── Подстановка эталонных шапки и реквизитов (из ЛК) в загруженный документ ───

/** Блоки верхнего уровня документа с их границами. */
/** Индекс ПОСЛЕ парного `</tag>` с учётом вложенности одноимённых тегов. -1 если не найден. */
function findMatchingClose(html: string, tag: string, afterOpenTag: number): number {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi')
  re.lastIndex = afterOpenTag
  let depth = 1
  let t: RegExpExecArray | null
  while ((t = re.exec(html))) {
    if (t[0][1] === '/') {
      depth--
      if (depth === 0) return t.index + t[0].length
    } else depth++
  }
  return -1
}

function topLevelBlocks(html: string): { start: number; end: number; tag: string; text: string }[] {
  const out: { start: number; end: number; tag: string; text: string }[] = []
  // Только ОТКРЫВАЮЩИЙ тег: парный закрывающий ищем с учётом вложенности.
  // Прежний нежадный `[\s\S]*?</\1>` останавливался на первом же </div>, из-за
  // чего двухколоночный блок реквизитов из Word (div.doc-layout-table с вложенными
  // div.doc-layout-cell) распознавался обрезанным — и замена реквизитов ломалась.
  const openRe = /<(h[1-6]|p|table|div|ul|ol)\b[^>]*>/gi
  let m: RegExpExecArray | null
  let pos = 0
  while ((m = openRe.exec(html))) {
    if (m.index < pos) continue
    const tag = m[1].toLowerCase()
    const end = findMatchingClose(html, tag, m.index + m[0].length)
    if (end < 0) continue
    const text = html.slice(m.index, end).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ start: m.index, end, tag, text })
    pos = end
    openRe.lastIndex = end
  }
  return out
}

const APPENDIX_START_RE = /^(приложение|дополнительное\s+соглашение|доп\.?\s*соглашение)\s*(№|N)?\s*\d/i
const REQ_DATA_RE = /(ИНН|ОГРН|ОГРНИП|БИК|р\/сч|к\/сч)/i

/**
 * Заменяет собственную шапку загруженного документа на эталонную из ЛК.
 * Шапка — всё до первого заголовка раздела. Меняем только если этот блок
 * действительно похож на шапку (стороны «в лице»/«именуемый») и он невелик.
 */
export function replaceDocumentPreamble(html: string, preambleHtml: string): { html: string; replaced: boolean } {
  if (!html || !preambleHtml) return { html, replaced: false }
  const blocks = topLevelBlocks(html)
  // Первый заголовок раздела (не заголовок-название документа в самом начале)
  const firstSection = blocks.find((b, i) => /^h[1-6]$/.test(b.tag) && i > 0 && !APPENDIX_START_RE.test(b.text))
  if (!firstSection) return { html, replaced: false }
  const region = html.slice(0, firstSection.start)
  const regionText = region.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  // Предохранители: это должна быть именно шапка и она не должна быть огромной.
  if (regionText.length > 3000) return { html, replaced: false }
  if (!/(именуем|в лице|заключили)/i.test(regionText)) return { html, replaced: false }
  return { html: `${preambleHtml}\n${html.slice(firstSection.start)}`, replaced: true }
}

/**
 * Заменяет блок реквизитов/подписей САМОГО ДОГОВОРА на эталонный из ЛК.
 * Ищем только до первого приложения — подписи внутри приложений не трогаем.
 * Заголовок раздела («13. Место нахождения и банковские реквизиты Сторон»)
 * сохраняем — меняем только его содержимое, чтобы не сбить нумерацию.
 */
export function replaceRequisitesSection(html: string, requisitesHtml: string): { html: string; replaced: boolean } {
  if (!html || !requisitesHtml) return { html, replaced: false }
  const blocks = topLevelBlocks(html)
  const firstAppendix = blocks.find((b) => /^h[1-6]$/.test(b.tag) && APPENDIX_START_RE.test(b.text))
  const limit = firstAppendix ? firstAppendix.start : html.length

  // Вариант 1: раздел с заголовком «Реквизиты…/Юридические адреса…/Место нахождения…».
  // Заголовок раздела сохраняем (нумерация), а ВЕСЬ хвост реквизитов и подписей до
  // приложения/конца (в т.ч. отдельные блоки подписей) заменяем одним системным блоком.
  const headingIdx = blocks.findIndex((b) => /^h[1-6]$/.test(b.tag) && b.start < limit && REQS_HEADER_RE.test(b.text))
  if (headingIdx >= 0) {
    const heading = blocks[headingIdx]
    const region = html.slice(heading.end, limit)
    if (!REQ_DATA_RE.test(region)) return { html, replaced: false } // не реквизиты — не трогаем
    return { html: html.slice(0, heading.end) + '\n' + requisitesHtml + '\n' + html.slice(limit), replaced: true }
  }

  // Вариант 2: блок реквизитов таблицей/div. Заголовок реквизитов мог попасть в
  // нумерованный список (тогда Вариант 1 его не видит) — отрезаем и его, и весь
  // хвост подписей до приложения/конца, заменяя одним системным блоком.
  const blockWithReqs = blocks.find(
    (b) => (b.tag === 'table' || b.tag === 'div') && b.start < limit && REQ_DATA_RE.test(b.text) && /Заказчик|Исполнитель/i.test(b.text),
  )
  if (blockWithReqs) {
    const merged = html.slice(0, blockWithReqs.start) + requisitesHtml + html.slice(limit)
    return { html: dropOrphanReqHeading(merged), replaced: true }
  }
  return { html, replaced: false }
}

// Убирает осиротевший заголовок реквизитов («ЮРИДИЧЕСКИЕ АДРЕСА…» и т.п.),
// оставшийся прямо перед вставленным системным блоком. Часто он попадает в <li>
// нумерованного списка разделов — тогда снимаем именно <li>, а закрывающий </ol>
// (по lookahead) остаётся на месте, и разметка не ломается.
function dropOrphanReqHeading(html: string): string {
  return html.replace(
    /(?:<(h[1-4]|p|li)\b[^>]*>)\s*(?:<strong>)?\s*(?:ЮРИДИЧЕСКИЕ\s+АДРЕСА|АДРЕСА\s+И\s+РЕКВИЗИТЫ|РЕКВИЗИТЫ\s+И\s+ПОДПИСИ|РЕКВИЗИТЫ\s+СТОРОН|Банковские\s+реквизиты|Место\s+нахождения)[^<]*(?:<\/strong>)?\s*<\/\1>\s*(?=(?:<\/(?:ol|ul)>\s*)*<div[^>]*class="[^"]*doc-requisites)/i,
    '',
  )
}

/** Находит конец блока <div…>, корректно считая вложенные div. Возвращает индекс ПОСЛЕ `</div>`. */
function findDivEnd(html: string, afterOpenTag: number): number {
  const tagRe = /<div\b[^>]*>|<\/div\s*>/gi
  tagRe.lastIndex = afterOpenTag
  let depth = 1
  let t: RegExpExecArray | null
  while ((t = tagRe.exec(html))) {
    if (t[0].startsWith('</')) {
      depth--
      if (depth === 0) return t.index + t[0].length
    } else depth++
  }
  return -1
}

/** Внутренности верхнеуровневых <div> внутри переданного фрагмента. */
function topLevelDivContents(inner: string): string[] {
  const out: string[] = []
  const openRe = /<div\b[^>]*>/gi
  let m: RegExpExecArray | null
  let pos = 0
  while ((m = openRe.exec(inner))) {
    if (m.index < pos) continue // внутри уже разобранного блока
    const contentStart = m.index + m[0].length
    const end = findDivEnd(inner, contentStart)
    if (end < 0) break
    out.push(inner.slice(contentStart, end - inner.slice(0, end).match(/<\/div\s*>$/i)![0].length))
    pos = end
    openRe.lastIndex = end
  }
  return out
}

/**
 * Строка «город … дата» преамбулы держится на двух <span> внутри <p>. Редактор
 * (TipTap) произвольные span не понимает и выбрасывает их — после первой же
 * ручной правки шапки город и дата слипались («г. Москва12 февраля 2026 г.»),
 * причём навсегда: слипшийся вариант сохранялся в документ и уезжал в Word.
 *
 * Поэтому для редактора переводим строку в таблицу 1×2 — её структуру редактор
 * сохраняет. Конвертер DOCX понимает такую таблицу и рисует прежним способом
 * (город слева, дата по правому краю), см. html-docx-converter.
 */
export function preambleMetaToTable(html: string): string {
  if (!html || !/doc-preamble-meta/i.test(html)) return html
  return html.replace(
    /<p[^>]*class="[^"]*doc-preamble-meta[^"]*"[^>]*>([\s\S]*?)<\/p>/gi,
    (full, inner: string) => {
      const spans = [...inner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => m[1]!.trim())
      if (spans.length < 2) return full
      const [city, date] = spans
      return (
        '<table class="doc-preamble-meta-table"><tbody><tr>' +
        `<td>${city}</td><td class="ta-right">${date}</td>` +
        '</tr></tbody></table>'
      )
    },
  )
}

export function layoutDivsToTables(html: string): string {
  // Оба варианта блока реквизитов/подписей: системный doc-requisites и
  // развёрнутый из Word doc-layout-table. NB: doc-requisites не должен матчить
  // doc-requisites-party/-title (отсекаем через (?![-\w])).
  if (!html || !/doc-layout-table|doc-requisites(?![-\w])/i.test(html)) return html
  const openRe = /<div[^>]*class="[^"]*(?:doc-layout-table|doc-requisites)(?![-\w])[^"]*"[^>]*>/gi
  let out = ''
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = openRe.exec(html))) {
    if (m.index < pos) continue
    const contentStart = m.index + m[0].length
    const end = findDivEnd(html, contentStart)
    if (end < 0) break
    const closeLen = html.slice(0, end).match(/<\/div\s*>$/i)![0].length
    const inner = html.slice(contentStart, end - closeLen)
    // Ведущий контент до первой колонки (например заголовок «РЕКВИЗИТЫ И ПОДПИСИ
    // СТОРОН») выносим ПЕРЕД таблицей. Колонки — верхнеуровневые <div>.
    const firstDiv = inner.search(/<div\b/i)
    const leading = firstDiv > 0 ? inner.slice(0, firstDiv) : ''
    const cells = topLevelDivContents(firstDiv >= 0 ? inner.slice(firstDiv) : inner)
    out += html.slice(pos, m.index)
    out += cells.length >= 2
      ? `${leading}<table class="doc-requisites-table"><tbody><tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr></tbody></table>`
      : html.slice(m.index, end)
    pos = end
    openRe.lastIndex = end
  }
  return pos === 0 ? html : out + html.slice(pos)
}

/**
 * Достраивает заголовки только если их ещё нет в документе. Безопасно для:
 * — сгенерированных с нуля (уже содержат <h1>/<h2> → не трогаем);
 * — новых загрузок (заголовки достроены при загрузке → не трогаем);
 * — УЖЕ ЗАГРУЖЕННЫХ ранее (заголовков нет → достраиваем на лету при открытии/скачивании,
 *   не переписывая оригинал в базе).
 */
export function maybePromoteHeadings(html: string): string {
  if (!html) return ''
  // Системно-сгенерированные документы уже со структурой — у них есть классы
  // преамбулы/реквизитов. Их не трогаем. У загруженных (mammoth) таких классов нет,
  // поэтому достраиваем заголовки — даже если часть разделов уже размечена стилями Word.
  if (/class="[^"]*doc-(?:preamble|requisites)/i.test(html)) return html
  return promoteHeadings(html)
}

/**
 * Собирает короткие <p>-строки — кандидаты в заголовки (заголовки всегда короткие).
 * Возвращает тексты и глобальные индексы <p> (для точной обратной обёртки без
 * изменения текста). Ограничение по длине заодно минимизирует объём и ПДн, уходящие в ИИ.
 */
export function collectHeadingCandidates(html: string): { texts: string[]; globalIndex: number[] } {
  const texts: string[] = []
  const globalIndex: number[] = []
  let j = -1
  html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_full, inner: string) => {
    j++
    const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (text.length < 3 || text.length > 90) return _full
    // Не кандидаты: подписи/ФИО/названия сторон/реквизиты/строки-заполнители.
    if (isNonHeadingLine(text)) return _full
    texts.push(text); globalIndex.push(j)
    return _full
  })
  return { texts, globalIndex }
}

/**
 * Оборачивает <p> с указанными глобальными индексами в <h1> (название) / <h2> (разделы).
 * Текст НЕ меняется — только тег. Должна применяться к тому же HTML, из которого
 * собирались кандидаты (индексы <p> совпадают).
 */
export function applyHeadingIndices(html: string, titleGlobalIdx: number | null, headingGlobalIdx: Set<number>): string {
  let j = -1
  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
    j++
    const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return full
    if (j === titleGlobalIdx) return `<h1>${text}</h1>`
    if (headingGlobalIdx.has(j)) return `<h2>${text}</h2>`
    return full
  })
}

// ─── markdownToLegalHtml ──────────────────────────────────────────────────────

/**
 * Конвертирует Markdown-документ (старый формат) в HTML.
 * Используется для миграции существующих документов.
 */
export async function markdownToLegalHtml(markdown: string): Promise<string> {
  // Убираем %%REQS_TABLE%% маркеры — они будут обработаны отдельно
  const reqsMatch = markdown.match(/\n*(%%REQS_TABLE%%[\s\S]*?%%END_REQS%%)\s*$/)
  const reqsBlock = reqsMatch ? reqsMatch[1] : null
  const mdWithoutReqs = reqsBlock
    ? markdown.slice(0, markdown.length - reqsMatch![0].length).trimEnd()
    : markdown

  const { marked } = await import('marked')
  marked.setOptions({ gfm: true, breaks: false })
  const html = await marked.parse(mdWithoutReqs)

  let result = sanitizeHtml(html)
  result = normalizeLegalHtml(result)

  // Добавляем HTML-реквизиты если они были в Markdown-формате
  if (reqsBlock) {
    const reqsHtml = convertMarkdownRequisites(reqsBlock)
    result = result + '\n' + reqsHtml
  }

  return result
}

/**
 * Конвертирует Markdown-блок %%REQS_TABLE%% в HTML-блок реквизитов.
 */
function convertMarkdownRequisites(reqsBlock: string): string {
  // Парсим старый формат: %%REQS_TABLE%%\ncol1%%COL_SEP%%col2\n%%END_REQS%%
  const inner = reqsBlock
    .replace(/^%%REQS_TABLE%%\s*/m, '')
    .replace(/\s*%%END_REQS%%\s*$/, '')
    .trim()

  const sepIdx = inner.indexOf('%%COL_SEP%%')
  if (sepIdx === -1) {
    // Нет разделителя — одна колонка
    return `<div class="doc-requisites"><div class="doc-requisites-col">${convertMdLines(inner)}</div></div>`
  }

  const col1 = inner.slice(0, sepIdx).trim()
  const col2 = inner.slice(sepIdx + '%%COL_SEP%%'.length).trim()

  return [
    '<div class="doc-requisites">',
    `  <div class="doc-requisites-col">${convertMdLines(col1)}</div>`,
    `  <div class="doc-requisites-col">${convertMdLines(col2)}</div>`,
    '</div>',
  ].join('\n')
}

function convertMdLines(md: string): string {
  return md
    .split('\n')
    .map(line => {
      const t = line.trim()
      if (!t) return ''
      // **жирный** → <strong>
      const html = t
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      return `<p>${html}</p>`
    })
    .filter(Boolean)
    .join('\n')
}

// ─── buildContractPreambleHtml ─────────────────────────────────────────────────

import type { CounterpartyData, UserProfileData } from './ai/types'

const TYPE_RU: Record<string, string> = {
  SOLE_PROPRIETOR: 'Индивидуальный предприниматель',
  COMPANY: 'Общество с ограниченной ответственностью',
  INDIVIDUAL: '',
  SELF_EMPLOYED: '',
}

function partyFullName(name: string, type: string): string {
  const t = TYPE_RU[type] ?? type
  // \b после кириллицы в JS-regex (без /u) не срабатывает, поэтому «ООО «Медикал…»
  // не распознавался как уже-с-префиксом → получалось «Общество… ООО «Медикал…».
  // Явно требуем после префикса пробел/кавычку/пунктуацию/конец.
  if (/^(ИП|ООО|АО|ПАО|ЗАО|АНО|Общество|Индивидуальный|Акционерное|Публичное|Частное)(?=\s|«|"|\.|,|$)/.test(name)) return name
  if (type === 'SOLE_PROPRIETOR') return `Индивидуальный предприниматель ${name}`
  if (!t) return name
  return `${t} ${name}`
}

// Коды основания полномочий (enum подписанта) → родительный падеж для оборота
// «действующий на основании …». Иначе в преамбуле светился сырой код (CERTIFICATE).
const BASIS_GENITIVE: Record<string, string> = {
  CHARTER: 'Устава',
  POA: 'Доверенности',
  CERTIFICATE: 'Свидетельства о государственной регистрации',
  REGULATION: 'Положения',
  OTHER: 'иного документа',
}

function buildBasisPhrase(
  type: string,
  ogrn: string | null | undefined,
  signatorBasis: string | null | undefined,
  ogrnDate?: string | null,
): string {
  if (signatorBasis && /^\d+$/.test(signatorBasis.trim())) {
    if (type === 'SOLE_PROPRIETOR') return ogrnDate ? `ОГРНИП ${signatorBasis} от ${ogrnDate} г.` : `ОГРНИП ${signatorBasis}`
    return `ОГРН ${signatorBasis}`
  }
  if (signatorBasis) {
    // Известный код основания — переводим; произвольный текст оставляем как есть.
    const key = signatorBasis.trim().toUpperCase()
    return BASIS_GENITIVE[key] ?? signatorBasis
  }
  if (type === 'SOLE_PROPRIETOR' && ogrn) return ogrnDate ? `ОГРНИП ${ogrn} от ${ogrnDate} г.` : `ОГРНИП ${ogrn}`
  return 'Устава'
}

/**
 * Генерирует HTML-преамбулу договора (шапка «г. Москва ... дата» + «ИП Иванов..., именуемый
 * в дальнейшем «Заказчик», ... заключили настоящий договор о нижеследующем:»).
 * Собирается детерминированно из данных профиля/контрагента — НЕ зависит от того,
 * напишет ли её ИИ сам (промпт просит его не писать преамбулу, но это ненадёжно).
 */
function isIndividualType(type: string | null | undefined): boolean {
  return type === 'INDIVIDUAL' || type === 'SELF_EMPLOYED'
}

// Предложение-представление физлица/самозанятого: ФИО, паспорт, адрес регистрации,
// (для самозанятого) оговорка про НПД. Без «в лице …, действующего на основании …» —
// физлицо по ГК ст. 160 подписывает лично.
function individualPreambleSentence(
  party: {
    name?: string | null
    passportSeries?: string | null
    passportNumber?: string | null
    passportIssuedBy?: string | null
    passportIssueDate?: string | null
    legalAddress?: string | null
  },
  type: string,
  role: string,
  tail: string,
): string {
  const bits: string[] = [esc(party.name ?? '')]
  const sn = [party.passportSeries, party.passportNumber].filter(Boolean).join(' № ')
  if (sn) {
    let pass = `паспорт ${sn}`
    const issued = [party.passportIssuedBy, party.passportIssueDate].filter(Boolean).join(' ')
    if (issued) pass += `, выдан ${issued}`
    bits.push(esc(pass))
  }
  if (party.legalAddress) bits.push(`зарегистрирован по адресу ${esc(party.legalAddress)}`)
  if (type === 'SELF_EMPLOYED') bits.push('применяющий специальный налоговый режим «Налог на профессиональный доход»')
  return `${bits.join(', ')}, именуемый в дальнейшем «${esc(role)}», ${tail}`
}

// Собирает предложения-«представления» сторон (без финального «заключили…»).
// Общее для основного договора и для приложений/допсоглашений.
function buildPartyPreambleParts(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
): string[] {
  const p1Type = userProfile.type
  const p2Type = counterparty.type ?? (counterparty.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR')
  const p1FullName = partyFullName(userProfile.name, p1Type)
  const p2FullName = partyFullName(counterparty.name, p2Type)
  const p1Basis = buildBasisPhrase(p1Type, userProfile.ogrn, userProfile.signatorBasis, userProfile.ogrnDate)
  const p2Basis = buildBasisPhrase(p2Type, counterparty.ogrn, counterparty.signatorBasis)

  const parts: string[] = []

  // ── Сторона 1 (профиль пользователя) ──
  if (isIndividualType(p1Type)) {
    parts.push(individualPreambleSentence(userProfile, p1Type, role1, 'с одной стороны, и'))
  } else if (p1Type === 'SOLE_PROPRIETOR') {
    parts.push(`${esc(p1FullName)}, именуемый в дальнейшем «${esc(role1)}», действующий на основании ${esc(p1Basis)}, с одной стороны, и`)
  } else {
    const signatorPhrase = userProfile.signatorName
      ? `в лице ${esc(userProfile.signatorPosition ?? 'директора')} ${esc(userProfile.signatorName)}, действующего на основании ${esc(p1Basis)},`
      : ''
    parts.push(`${esc(p1FullName)} ${signatorPhrase} именуемое в дальнейшем «${esc(role1)}», с одной стороны, и`)
  }

  // ── Сторона 2 (контрагент) ──
  if (isIndividualType(p2Type)) {
    parts.push(individualPreambleSentence(counterparty, p2Type, role2, 'с другой стороны,'))
  } else if (p2Type === 'SOLE_PROPRIETOR') {
    const signLine = counterparty.signatorName ? esc(counterparty.signatorName) : '____________'
    const basisLine = counterparty.signatorName ? esc(p2Basis) : '_____________'
    parts.push(`Индивидуальный предприниматель ${signLine}, именуемый в дальнейшем «${esc(role2)}», действующий на основании ${basisLine}, с другой стороны,`)
  } else {
    const signPhrase = counterparty.signatorName
      ? `в лице ${esc(counterparty.signatorPosition ?? 'директора')} ${esc(counterparty.signatorName)}, действующего на основании ${esc(p2Basis)},`
      : 'в лице _____________, действующего на основании _____________,'
    parts.push(`${esc(p2FullName)} ${signPhrase} именуемое в дальнейшем «${esc(role2)}», с другой стороны,`)
  }

  return parts
}

function preambleMetaLine(city?: string, signingDate?: string): string {
  const cityLine = `г. ${esc(city ?? 'Москва')}`
  const dateLine = signingDate
    ? esc(new Date(signingDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }))
    : '«___» ____________ 202__ г.'
  // Город слева, дата справа: два span'а. На экране разводит CSS (flex space-between),
  // при выгрузке в Word — правый таб-стоп (см. html-docx-converter, doc-preamble-meta).
  return `<p class="doc-preamble-meta"><span class="doc-preamble-city">${cityLine}</span><span class="doc-preamble-date">${dateLine}</span></p>`
}

export function buildContractPreambleHtml(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
  city?: string,
  signingDate?: string,
  contractNumber?: string | null,
): string {
  const parts = buildPartyPreambleParts(userProfile, counterparty, role1, role2)
  parts.push('совместно именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем:')
  const num = contractNumber?.trim() ? ` № ${esc(contractNumber.trim())}` : ''
  return [
    // Заголовок документа. Раньше его в шапке основного договора не было вовсе
    // (был только у приложений/ДС), и договор начинался прямо со строки «город — дата».
    // Класс ta-center понимают оба рендера — CSS предпросмотра и конвертер DOCX
    // (alignFromClass), поэтому отдельной ветки под этот абзац нигде не нужно.
    `<p class="doc-preamble-title ta-center"><strong>ДОГОВОР${num}</strong></p>`,
    preambleMetaLine(city, signingDate),
    `<p class="doc-preamble">${parts.join(' ')}</p>`,
  ].join('\n')
}

// Шапка-преамбула для ПРИЛОЖЕНИЙ и ДОПСОГЛАШЕНИЙ: заголовок «Приложение/
// Дополнительное соглашение № N к Договору № X» + представление сторон +
// «заключили настоящее Приложение/Дополнительное соглашение». Раньше дочерние
// документы вообще не получали шапку (только основные договоры), из-за чего
// приложение/ДС начиналось прямо с раздела «Реквизиты документа» без шапки.
export function buildChildDocPreambleHtml(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
  docType: string,
  documentNumber?: number,
  parentNumber?: string,
  parentTitle?: string,
  city?: string,
  signingDate?: string,
): string {
  const label = docType === 'AMENDMENT' ? 'Дополнительное соглашение' : 'Приложение'
  const num = documentNumber ? ` № ${documentNumber}` : ''
  const parentRef = parentNumber ? `№ ${esc(parentNumber)}` : (parentTitle ? `«${esc(parentTitle)}»` : '')
  const titleLine = `${label}${num} к Договору ${parentRef}`.replace(/\s+/g, ' ').trim()
  const parts = buildPartyPreambleParts(userProfile, counterparty, role1, role2)
  parts.push(`совместно именуемые «Стороны», заключили настоящее ${label} о нижеследующем:`)
  return [
    // ta-center: в DOCX заголовок и так центрируется (ветка isAttachmentStart),
    // а в предпросмотре без класса он прижимался влево — рендеры расходились.
    `<p class="doc-preamble-title ta-center"><strong>${esc(titleLine)}</strong></p>`,
    preambleMetaLine(city, signingDate),
    `<p class="doc-preamble">${parts.join(' ')}</p>`,
  ].join('\n')
}

/**
 * Удаляет преамбулу, которую всё-таки написал сам ИИ (вопреки инструкции «не пиши сам»),
 * перед тем как подставить детерминированную версию из buildContractPreambleHtml().
 * Преамбула — это всё что идёт до первого заголовка <h1-4>. Если ИИ выполнил инструкцию
 * и начал документ прямо с «1. ПРЕДМЕТ ДОГОВОРА» — функция ничего не меняет.
 */
/**
 * Делит документ на шапку (всё до первого заголовка раздела) и тело.
 * Нужно там, где шапку нельзя отдавать ИИ: она собрана детерминированно из ЛК,
 * а модель, получив её вместе с телом, переписывает стороны и основания. Тело
 * правим, шапку возвращаем на место нетронутой — так же, как подвал реквизитов
 * (см. splitRequisitesBlock).
 * Если документ начинается прямо с заголовка раздела — шапки нет, тело целиком.
 */
export function splitDocumentPreamble(html: string): { preamble: string; body: string } {
  const firstHeadingMatch = html.match(/<h[1-4][^>]*>/i)
  if (!firstHeadingMatch || firstHeadingMatch.index === undefined || firstHeadingMatch.index === 0) {
    return { preamble: '', body: html }
  }
  const before = html.slice(0, firstHeadingMatch.index)
  const text = before.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  if (!text) return { preamble: '', body: html }
  return { preamble: before.trimEnd(), body: html.slice(firstHeadingMatch.index) }
}

export function stripAiPreamble(html: string): string {
  return splitDocumentPreamble(html).body
}

/**
 * Генерирует HTML-блок реквизитов и подписей сторон.
 * Заменяет старый buildRequisitesBlock() который возвращал Markdown.
 */
/**
 * Обрезает HTML-документ перед тем местом, где ИИ сам написал блок реквизитов/подписей
 * (заголовок «Реквизиты», «Подписи сторон», абзац «Заказчик:» / «Исполнитель:» и т.п.).
 * Ищет по РЕАЛЬНОМУ ТЕКСТУ абзаца (без тегов), а не по конкретной разметке —
 * поэтому не зависит от того, обернул ли ИИ двоеточие в <strong> или вынес его наружу.
 * Нужно, чтобы свой собственный блок (buildRequisitesHtml) не дублировался с тем,
 * что ИИ иногда дописывает в конце документа.
 */
// Паттерн заголовков-маркеров блока подписей/реквизитов.
// Используется и при поиске paragraph-маркеров, и при «зачистке» предшествующего заголовка.
// Заголовок ПОДВАЛА реквизитов/подписей сторон. ВАЖНО: не матчить «Реквизиты
// документа» — это НАЧАЛЬНЫЙ раздел приложений/ДС (номер, дата, место), а не
// подвал. Раньше голое «РЕКВИЗИТЫ» матчило «1. РЕКВИЗИТЫ ДОКУМЕНТА» → весь
// документ считался подвалом и тело обрезалось в пустоту, из-за чего правки/чат/
// проверка приложений и ДС не работали. Поэтому «Реквизиты» — только в связках
// «и подписи»/«сторон» (или «Банковские реквизиты»).
const REQS_HEADER_RE =
  /^(\d+[.)]\s*)?(РЕКВИЗИТЫ\s+И\s+ПОДПИСИ(\s+СТОРОН)?|РЕКВИЗИТЫ\s+СТОРОН|Реквизиты\s+и\s+подписи(\s+сторон)?|Реквизиты\s+сторон|ПОДПИСИ\s+СТОРОН|Подписи\s+сторон|Банковские\s+реквизиты|Юридические\s+адреса|Адреса\s+и\s+реквизиты|Место\s+нахождения|Заказчик\s*:?\s*$|Исполнитель\s*:?\s*$)/i

// Убирает заголовок/абзац-маркер непосредственно перед найденной позицией cutAt.
// Word-документы часто содержат строку «Подписи сторон» / «1. Подписи сторон» и т.п.
// ПЕРЕД таблицей/блоком реквизитов — и эту строку тоже нужно вырезать.
function stripPrecedingHeader(html: string, cutAt: number): number {
  const before = html.slice(0, cutAt).trimEnd()
  // Ищем последний блочный тег <h1-4> или <p> перед cutAt
  const lastBlockRe = /<(h[1-4]|p)[^>]*>([\s\S]*?)<\/\1>\s*$/i
  const m = before.match(lastBlockRe)
  if (!m) return cutAt
  const innerText = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  if (REQS_HEADER_RE.test(innerText)) {
    return before.length - m[0].length
  }
  return cutAt
}

export function stripAiRequisitesBlock(html: string): string {
  return splitRequisitesBlock(html).body
}

/**
 * Есть ли после позиции `fromIdx` начало нового раздела или приложения.
 * Нужно, чтобы не принять раздел в СЕРЕДИНЕ договора (например
 * «13. Место нахождения и банковские реквизиты Сторон») за подвал документа
 * и не отрезать вместе с ним приложения, которые идут дальше.
 * NB: \b не работает с кириллицей в JS-regex — используем lookahead.
 */
function hasSectionsAfter(html: string, fromIdx: number): boolean {
  const tail = html.slice(fromIdx)
  const blockRe = /<(h[1-4]|p)[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(tail))) {
    const t = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!t) continue
    // Начало приложения/допсоглашения
    if (/^(приложение|дополнительное\s+соглашение|доп\.?\s*соглашение|спецификация)(?=\s|№|\d|:|$)/i.test(t)) return true
    // Заголовок нумерованного раздела («2. Спецификация», «3. Стоимость услуг»)
    if (/^\d{1,2}[.)]\s*[А-ЯЁA-Z]/.test(t)) return true
  }
  return false
}

/**
 * Отделяет подвал с реквизитами/подписями от тела договора.
 * Тело можно безопасно отправлять в ИИ; подвал возвращается как есть.
 */
export function splitRequisitesBlock(html: string): { body: string; requisites: string } {
  // ── Вариант A: подписи оформлены абзацами/заголовками ────────────────────
  const blockRe = /<(h[1-4]|p)[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html))) {
    const innerText = match[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim()
    if (REQS_HEADER_RE.test(innerText)) {
      // Подвал — это ХВОСТ документа. Если после найденного заголовка идут новые
      // разделы или приложения («13. Место нахождения…», а дальше «Приложение №1»),
      // то это НЕ подвал, а раздел в середине — иначе мы отрезали бы приложения.
      if (hasSectionsAfter(html, match.index + match[0].length)) continue
      return {
        body: html.slice(0, match.index).trimEnd(),
        requisites: html.slice(match.index).trim(),
      }
    }
  }

  // ── Вариант B: подписи оформлены таблицей ────────────────────────────────
  const REQS_RE = /ИНН|Р\/сч[её]т|ОГРНИП|ОГРН|БИК|К\/сч[её]т|Заказчик\s*:|Исполнитель\s*:/i
  const tableMatches = [...html.matchAll(/<table[\s>]/gi)]
  if (tableMatches.length > 0) {
    const tableStart = tableMatches[tableMatches.length - 1].index!
    const tableEndIdx = html.lastIndexOf('</table>')
    if (tableEndIdx > tableStart) {
      const tableHtml = html.slice(tableStart, tableEndIdx + '</table>'.length)
      if (REQS_RE.test(tableHtml)) {
        const cutAt = stripPrecedingHeader(html, tableStart)
        return {
          body: html.slice(0, cutAt).trimEnd(),
          requisites: html.slice(cutAt).trim(),
        }
      }
    }
  }

  // ── Вариант C: наш системный блок doc-requisites / layout-table ───────────
  const layoutMatches = [...html.matchAll(/<div[^>]*class="(?:doc-requisites|doc-layout-table)"[^>]*>/gi)]
  if (layoutMatches.length > 0) {
    const divStart = layoutMatches[layoutMatches.length - 1].index!
    return {
      body: html.slice(0, divStart).trimEnd(),
      requisites: html.slice(divStart).trim(),
    }
  }

  return { body: html, requisites: '' }
}

/**
 * Legacy-детект: версии, созданные до слоя оформления, содержат блок реквизитов
 * прямо в content — для них слой оформления не подставляется повторно.
 */
export function hasInlineRequisites(content: string): boolean {
  if (!content) return false
  return Boolean(splitRequisitesBlock(content).requisites)
}

export function buildRequisitesHtml(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
): string {
  const col1Lines = buildPartyLines(userProfile, role1)
  const col2Lines = buildPartyLines(counterparty, role2)

  return [
    '<div class="doc-requisites">',
    '  <h2 class="doc-requisites-title">РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2>',
    '  <div class="doc-requisites-party">',
    col1Lines.map(l => `    <p>${l}</p>`).join('\n'),
    '    <p class="doc-signature-line">__________&nbsp;/&nbsp;__________</p>',
    '  </div>',
    '  <div class="doc-requisites-party">',
    col2Lines.map(l => `    <p>${l}</p>`).join('\n'),
    '    <p class="doc-signature-line">__________&nbsp;/&nbsp;__________</p>',
    '  </div>',
    '</div>',
  ].join('\n')
}

function buildPartyLines(party: UserProfileData | CounterpartyData, role: string): string[] {
  const lines: string[] = []

  lines.push(`<strong>${role}:</strong>`)
  lines.push(esc(party.name ?? ''))

  if (party.legalAddress) lines.push(`Адрес: ${esc(party.legalAddress)}`)
  if (party.inn) lines.push(`ИНН: ${esc(party.inn)}`)
  if (party.kpp) lines.push(`КПП: ${esc(party.kpp)}`)
  // У контрагента нет явного типа (CounterpartyData.type не объявлен) — определяем
  // ИП по наличию КПП так же, как в buildContractPreambleHtml: КПП есть только у юрлиц.
  const isSoleProprietor = 'type' in party ? party.type === 'SOLE_PROPRIETOR' : !party.kpp
  if (party.ogrn) lines.push(`${isSoleProprietor ? 'ОГРНИП' : 'ОГРН'}: ${esc(party.ogrn)}`)

  // Банковские реквизиты
  if (party.bankName)             lines.push(`Банк: ${esc(party.bankName)}`)
  if (party.bik)                  lines.push(`БИК: ${esc(party.bik)}`)
  if (party.checkingAccount)      lines.push(`Р/счет: ${esc(party.checkingAccount)}`)
  if (party.correspondentAccount) lines.push(`К/счет: ${esc(party.correspondentAccount)}`)

  if (party.email) lines.push(`E-mail: ${esc(party.email)}`)

  // Подписант — берём напрямую из party.signatorName/signatorPosition
  // (эти поля заполняются выбранным подписантом ещё на шаге настройки документа).
  if (party.signatorName) lines.push(esc(party.signatorName))
  if (party.signatorPosition) lines.push(esc(party.signatorPosition))

  return lines
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── HTML prompt helper ───────────────────────────────────────────────────────

/**
 * Системная инструкция для AI о формате вывода HTML.
 * Используется в промптах генерации и редактирования.
 */
export const HTML_FORMAT_INSTRUCTION = `
ФОРМАТ ВЫВОДА — СТРОГО HTML:
Возвращай ТОЛЬКО валидный HTML. ЗАПРЕЩЕНО использовать markdown.

РАЗРЕШЁННЫЕ ТЕГИ:
- <h2> для заголовков разделов (1. ПРЕДМЕТ ДОГОВОРА, 2. ПРАВА И ОБЯЗАННОСТИ и т.д.)
- <h3> для подзаголовков внутри раздела
- <p> для каждого пункта, подпункта и абзаца
- <strong> для выделения важного текста
- <em> для курсива
- <ol><li> или <ul><li> для списков перечислений
- <table><thead><tbody><tr><th><td> для таблиц
- <br> для переноса строки внутри абзаца

ЗАПРЕЩЕНО:
- markdown-символы: **, *, #, -, >
- inline style атрибуты
- теги script, style, div, span, iframe
- блоки \`\`\`html ... \`\`\`
- любой текст до первого тега или после последнего тега

ПРИМЕР ПРАВИЛЬНОГО ФОРМАТА:
<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>
<p>1.1. Исполнитель обязуется оказать услуги по разработке сайта.</p>
<p>1.2. Результатом является работающий сайт согласно техническому заданию.</p>
<p>1.3. Услуги оказываются дистанционно.</p>

<h2>2. ПРАВА И ОБЯЗАННОСТИ СТОРОН</h2>
<p>2.1. Исполнитель обязан:</p>
<p>2.1.1. выполнить работу в указанный срок;</p>
<p>2.1.2. предоставить исходный код.</p>
<p>2.2. Заказчик обязан:</p>
<p>2.2.1. оплатить услуги в срок;</p>
<p>2.2.2. предоставить необходимые материалы.</p>
`.trim()
