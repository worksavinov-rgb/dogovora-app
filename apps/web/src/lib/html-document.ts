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
  if (/^(ИП|ООО|АО|ПАО|ЗАО|АНО|Общество|Индивидуальный|Акционерное|Публичное|Частное)\b/.test(name)) return name
  if (type === 'SOLE_PROPRIETOR') return `Индивидуальный предприниматель ${name}`
  if (!t) return name
  return `${t} ${name}`
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
  if (signatorBasis) return signatorBasis
  if (type === 'SOLE_PROPRIETOR' && ogrn) return ogrnDate ? `ОГРНИП ${ogrn} от ${ogrnDate} г.` : `ОГРНИП ${ogrn}`
  return 'Устава'
}

/**
 * Генерирует HTML-преамбулу договора (шапка «г. Москва ... дата» + «ИП Иванов..., именуемый
 * в дальнейшем «Заказчик», ... заключили настоящий договор о нижеследующем:»).
 * Собирается детерминированно из данных профиля/контрагента — НЕ зависит от того,
 * напишет ли её ИИ сам (промпт просит его не писать преамбулу, но это ненадёжно).
 */
export function buildContractPreambleHtml(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
  city?: string,
  signingDate?: string,
): string {
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

  parts.push('совместно именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем:')

  const cityLine = `г. ${esc(city ?? 'Москва')}`
  const dateLine = signingDate
    ? esc(new Date(signingDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }))
    : '«___» ____________ 202__ г.'

  return [
    `<p class="doc-preamble-meta">${cityLine}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${dateLine}</p>`,
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
export function stripAiRequisitesBlock(html: string): string {
  const blockRe = /<(h[1-4]|p)[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html))) {
    const innerText = match[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim()
    const isRequisitesMarker =
      /^(РЕКВИЗИТЫ|ПОДПИСИ(\s+СТОРОН)?|Реквизиты|Подписи(\s+сторон)?|Заказчик\s*:?\s*$|Исполнитель\s*:?\s*$|Банковские реквизиты|Место нахождения)/i.test(
        innerText,
      )
    if (isRequisitesMarker) {
      return html.slice(0, match.index).trimEnd()
    }
  }

  // ИИ иногда оформляет блок реквизитов/подписей не абзацами, а таблицей
  // (например, две колонки «Исполнитель:» / «Заказчик:» с данными и местом для
  // подписи). Предыдущий цикл такие таблицы не видит — проверяем их отдельно
  // по тем же маркерам и по характерным реквизитным реквизитам (ИНН, ОГРН и т.д.).
  const REQS_RE = /ИНН|Р\/сч[её]т|ОГРНИП|ОГРН|БИК|К\/сч[её]т|Заказчик\s*:|Исполнитель\s*:/i
  const tableMatches = [...html.matchAll(/<table[\s>]/gi)]
  if (tableMatches.length > 0) {
    const tableStart = tableMatches[tableMatches.length - 1].index!
    const tableEndIdx = html.lastIndexOf('</table>')
    if (tableEndIdx > tableStart) {
      const tableHtml = html.slice(tableStart, tableEndIdx + '</table>'.length)
      if (REQS_RE.test(tableHtml)) {
        return html.slice(0, tableStart).trimEnd()
      }
    }
  }

  return html
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
