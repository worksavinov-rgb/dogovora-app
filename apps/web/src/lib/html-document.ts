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

    // Удаляем style и event handlers, оставляем разрешённые атрибуты
    const cleanAttrs = attrs
      .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
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
export function promoteHeadings(html: string): string {
  if (!html) return ''
  let titleAssigned = false
  let idx = 0

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

  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
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

    // Признаки заголовка раздела:
    const numbered = /^\d{1,2}[.)]\s*[А-ЯЁA-Z]/.test(text)                  // «1. ПРЕДМЕТ …» / «4.Стоимость»
    const allCaps = /[А-ЯЁA-Z]/.test(text) && text === text.toUpperCase() && !/[a-zа-яё]/.test(text)
    const boldNoun = fullyBold && !/[.]$/.test(text)                        // жирная короткая строка без точки
    if (numbered || allCaps || boldNoun) return `<h2>${text}</h2>`
    return full
  })
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
    if (text.length >= 3 && text.length <= 90) { texts.push(text); globalIndex.push(j) }
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
// Собирает предложения-«представления» сторон (без финального «заключили…»).
// Общее для основного договора и для приложений/допсоглашений.
function buildPartyPreambleParts(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
): string[] {
  const p1Type = userProfile.type
  const p2Type = counterparty.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR'
  const p1FullName = partyFullName(userProfile.name, p1Type)
  const p2FullName = partyFullName(counterparty.name, p2Type)
  const p1Basis = buildBasisPhrase(p1Type, userProfile.ogrn, userProfile.signatorBasis, userProfile.ogrnDate)
  const p2Basis = buildBasisPhrase(p2Type, counterparty.ogrn, counterparty.signatorBasis)

  const parts: string[] = []

  if (p1Type === 'SOLE_PROPRIETOR') {
    parts.push(`${esc(p1FullName)}, именуемый в дальнейшем «${esc(role1)}», действующий на основании ${esc(p1Basis)}, с одной стороны, и`)
  } else {
    const signatorPhrase = userProfile.signatorName
      ? `в лице ${esc(userProfile.signatorPosition ?? 'директора')} ${esc(userProfile.signatorName)}, действующего на основании ${esc(p1Basis)},`
      : ''
    parts.push(`${esc(p1FullName)} ${signatorPhrase} именуемое в дальнейшем «${esc(role1)}», с одной стороны, и`)
  }

  if (p2Type === 'SOLE_PROPRIETOR') {
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
): string {
  const parts = buildPartyPreambleParts(userProfile, counterparty, role1, role2)
  parts.push('совместно именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем:')
  return [
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
    `<p class="doc-preamble-title"><strong>${esc(titleLine)}</strong></p>`,
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
export function stripAiPreamble(html: string): string {
  const firstHeadingMatch = html.match(/<h[1-4][^>]*>/i)
  if (!firstHeadingMatch || firstHeadingMatch.index === undefined || firstHeadingMatch.index === 0) return html
  const before = html.slice(0, firstHeadingMatch.index)
  const text = before.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  if (!text) return html
  return html.slice(firstHeadingMatch.index)
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
  /^(\d+[.)]\s*)?(РЕКВИЗИТЫ\s+И\s+ПОДПИСИ(\s+СТОРОН)?|РЕКВИЗИТЫ\s+СТОРОН|Реквизиты\s+и\s+подписи(\s+сторон)?|Реквизиты\s+сторон|ПОДПИСИ\s+СТОРОН|Подписи\s+сторон|Банковские\s+реквизиты|Место\s+нахождения|Заказчик\s*:?\s*$|Исполнитель\s*:?\s*$)/i

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
    '    <p class="doc-signature-line">_______________&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;_______________</p>',
    '  </div>',
    '  <div class="doc-requisites-party">',
    col2Lines.map(l => `    <p>${l}</p>`).join('\n'),
    '    <p class="doc-signature-line">_______________&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;_______________</p>',
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
