/**
 * html-docx-converter.ts
 * Конвертирует HTML (из marked или mammoth) в DOCX через библиотеку `docx`.
 *
 * Почему не html-to-docx: тот пакет генерирует структуру, которую принимают
 * мягкие парсеры (textutil, python-docx, LibreOffice), но Microsoft Word
 * считает повреждённой (особенно при объединённых ячейках — gridSpan=0).
 * Библиотека `docx` строит валидный OOXML, который открывается в MS Word.
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, HeadingLevel, VerticalMergeType, TabStopType,
} from 'docx'
import { marked } from 'marked'

export interface DocxOptions {
  title?: string
  margins?: { top?: number; right?: number; bottom?: number; left?: number }
  requisites?: {
    left: RequisitesParty   // левая колонка (по роли: Заказчик или Исполнитель)
    right: RequisitesParty  // правая колонка
    leftTitle: string       // «Заказчик» / «Исполнитель»
    rightTitle: string
    // Тип документа определяет финальный раздел:
    //  - CONTRACT → «Реквизиты и подписи сторон» с полными реквизитами
    //  - APPENDIX/AMENDMENT → «Подписи сторон» только с названием и ФИО подписанта
    docType?: 'CONTRACT' | 'APPENDIX' | 'AMENDMENT'
  }
  // Системная преамбула (шапка). Если задана — шаблонная шапка документа (всё до
  // раздела «1. …») вырезается, и сверху ставится сгенерированная: заголовок,
  // город/дата и абзац со сторонами с подставленными ФИО подписантов и основаниями.
  preamble?: {
    docTitle: string          // «Договор оказания услуг»
    docNumber?: string | null // «12»
    city?: string | null      // «Москва»
    date?: string | null      // уже отформатированная дата или null → прочерк
    customer: RequisitesParty  // сторона-Заказчик
    executor: RequisitesParty  // сторона-Исполнитель
  }
}

export interface RequisitesParty {
  type: string              // SOLE_PROPRIETOR | COMPANY | ZAO | PAO | ANO | INDIVIDUAL
  name?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  email?: string | null
  signatorName?: string | null
  signatorPosition?: string | null
  bankName?: string | null
  bik?: string | null
  checkingAccount?: string | null
  correspondentAccount?: string | null
}

// Ширина контента на A4 (12240 - поля) в твипах
const CONTENT_WIDTH = 9000

// ─── Мини-парсер HTML ─────────────────────────────────────────────────────────
// Работает с уже санитизированным, валидным HTML (ограниченный набор тегов).

type TextNode = { type: 'text'; text: string }
type ElNode = { type: 'el'; tag: string; attribs: Record<string, string>; children: Node[] }
type Node = TextNode | ElNode

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col'])
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\/?>/g

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseAttribs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) attrs[m[1]!.toLowerCase()] = m[2]!
  return attrs
}

/** Парсит HTML-строку в дерево узлов. */
function parseHtml(html: string): Node[] {
  const root: ElNode = { type: 'el', tag: '#root', attribs: {}, children: [] }
  const stack: ElNode[] = [root]
  let lastIndex = 0
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null

  const pushText = (raw: string) => {
    const text = decodeEntities(raw)
    if (text) stack[stack.length - 1]!.children.push({ type: 'text', text })
  }

  while ((m = TAG_RE.exec(html)) !== null) {
    if (m.index > lastIndex) pushText(html.slice(lastIndex, m.index))
    lastIndex = TAG_RE.lastIndex

    const isClose = m[1] === '/'
    const tag = m[2]!.toLowerCase()
    const selfClose = VOID_TAGS.has(tag) || m[0].endsWith('/>')

    if (selfClose) {
      stack[stack.length - 1]!.children.push({ type: 'el', tag, attribs: parseAttribs(m[3] ?? ''), children: [] })
      continue
    }
    if (!isClose) {
      const el: ElNode = { type: 'el', tag, attribs: parseAttribs(m[3] ?? ''), children: [] }
      stack[stack.length - 1]!.children.push(el)
      stack.push(el)
    } else {
      // Закрываем до соответствующего тега (устойчиво к незакрытым)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) { stack.length = i; break }
      }
    }
  }
  if (lastIndex < html.length) pushText(html.slice(lastIndex))
  return root.children
}

// ─── Инлайн-руны ────────────────────────────────────────────────────────────

interface RunStyle { bold?: boolean; italics?: boolean; color?: string; highlight?: string }

/**
 * #RRGGBB / #RGB / rgb() / rgba() / имя цвета → 'RRGGBB' (формат docx).
 *
 * rgb() обязателен: цвет ставится как #C81E1E, но редактор читает его обратно из
 * DOM (element.style.color), а браузер нормализует значение в «rgb(200, 30, 30)».
 * Пока этот формат не разбирался, цветные пометки пользователя молча пропадали
 * при выгрузке в Word и в точном предпросмотре.
 */
function docxColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const v = value.trim().toLowerCase()

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1]!
    return (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toUpperCase()
  }

  // rgb(200, 30, 30) / rgba(200 30 30 / 0.5) — разделители: запятые, пробелы, слэш
  const rgb = v.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean)
    if (parts.length >= 3) {
      const channels = parts.slice(0, 3).map((p) => {
        // допускаем проценты: rgb(100%, 0%, 0%)
        const pct = p.endsWith('%')
        const n = Number.parseFloat(p)
        if (!Number.isFinite(n)) return null
        const byte = pct ? Math.round((n / 100) * 255) : Math.round(n)
        return Math.min(255, Math.max(0, byte))
      })
      if (channels.every((c): c is number => c !== null)) {
        return channels.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
      }
    }
    return undefined
  }

  const named: Record<string, string> = {
    red: 'FF0000', green: '008000', blue: '0000FF', black: '000000',
    yellow: 'FFFF00', orange: 'FFA500', gray: '808080', grey: '808080',
  }
  return named[v]
}

/** Достаёт color / background-color из инлайнового style элемента. */
function styleColors(attribs: Record<string, string>): { color?: string; background?: string } {
  const style = attribs['style']
  if (!style) return {}
  const out: { color?: string; background?: string } = {}
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (prop === 'color' && value !== 'inherit') out.color = value
    else if (prop === 'background-color' && value !== 'transparent') out.background = value
  }
  return out
}

function collectRuns(nodes: Node[], style: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      const text = n.text.replace(/\s+/g, ' ')
      if (text) {
        runs.push(new TextRun({
          text,
          bold: style.bold,
          italics: style.italics,
          // Цветные пометки пользователя переносим в Word как есть
          ...(style.color ? { color: style.color } : {}),
          ...(style.highlight ? { shading: { fill: style.highlight } } : {}),
        }))
      }
      continue
    }
    if (n.tag === 'br') { runs.push(new TextRun({ break: 1 })); continue }
    if (n.tag === 'strong' || n.tag === 'b') { runs.push(...collectRuns(n.children, { ...style, bold: true })); continue }
    if (n.tag === 'em' || n.tag === 'i') { runs.push(...collectRuns(n.children, { ...style, italics: true })); continue }
    // span / mark и прочие инлайн-обёртки: наследуем стиль, добавляя цвета
    const { color, background } = styleColors(n.attribs)
    const nextStyle: RunStyle = { ...style }
    const fg = docxColor(color)
    if (fg) nextStyle.color = fg
    // <mark> без явного фона — жёлтая заливка по умолчанию (как в редакторе)
    const bg = docxColor(background) ?? (n.tag === 'mark' ? 'FFF176' : undefined)
    if (bg) nextStyle.highlight = bg
    runs.push(...collectRuns(n.children, nextStyle))
  }
  return runs
}

function isBlank(runs: TextRun[]): boolean {
  return runs.length === 0
}

// ─── Блоки ────────────────────────────────────────────────────────────────────

const SINGLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const CELL_BORDERS = { top: SINGLE_BORDER, bottom: SINGLE_BORDER, left: SINGLE_BORDER, right: SINGLE_BORDER }

function headingFor(tag: string) {
  // Заголовки разделов в договорах принято центрировать (как и название документа).
  if (tag === 'h1') return { heading: HeadingLevel.HEADING_1, align: AlignmentType.CENTER }
  if (tag === 'h2') return { heading: HeadingLevel.HEADING_2, align: AlignmentType.CENTER }
  if (tag === 'h3') return { heading: HeadingLevel.HEADING_3, align: AlignmentType.CENTER }
  return { heading: HeadingLevel.HEADING_4, align: AlignmentType.CENTER }
}

// Явное выравнивание из класса ta-* (тулбар предпросмотра / выравнивание из Word).
// Переопределяет дефолт (тело — JUSTIFIED, заголовки — CENTER). undefined = нет класса.
type DocxAlign = (typeof AlignmentType)[keyof typeof AlignmentType]
function alignFromClass(cls: string | undefined): DocxAlign | undefined {
  if (!cls) return undefined
  if (/\bta-justify\b/.test(cls)) return AlignmentType.JUSTIFIED
  if (/\bta-center\b/.test(cls)) return AlignmentType.CENTER
  if (/\bta-right\b/.test(cls)) return AlignmentType.RIGHT
  if (/\bta-left\b/.test(cls)) return AlignmentType.LEFT
  return undefined
}

// ─── Многоуровневая нумерация списков ──────────────────────────────────────────
// Номера считаем сами и вставляем текстом — так DOCX 1:1 совпадает с предпросмотром
// (CSS-счётчики), включая вложенность 1., 1.1., 1.1.1. Стиль читаем из класса <ol>.
type ListStyle = 'legal' | 'alpha' | 'roman'
function listStyleOf(node: ElNode): ListStyle {
  const cls = node.attribs['class'] ?? ''
  if (/\bol-alpha\b/.test(cls)) return 'alpha'
  if (/\bol-roman\b/.test(cls)) return 'roman'
  return 'legal'
}
function toAlpha(n: number): string {
  let s = ''
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) }
  return s
}
function toRoman(n: number): string {
  const map: [number, string][] = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']]
  let s = ''
  for (const [v, sym] of map) while (n >= v) { s += sym; n -= v }
  return s
}
function orderedPrefix(style: ListStyle, arabicPath: number[], levelIndex: number): string {
  if (style === 'alpha') return `${toAlpha(levelIndex)}) `
  if (style === 'roman') return `${toRoman(levelIndex)}) `
  return `${arabicPath.join('.')}. `
}
// Инлайн-содержимое пункта БЕЗ вложенных списков (их обходим рекурсивно).
// TipTap оборачивает текст пункта в один <p> — разворачиваем.
function listItemInline(li: ElNode): Node[] {
  const nonLists = li.children.filter((c) => !(c.type === 'el' && (c.tag === 'ul' || c.tag === 'ol')))
  const els = nonLists.filter((c): c is ElNode => c.type === 'el')
  const only = els.length === 1 ? els[0] : undefined
  if (only && only.tag === 'p') return only.children
  return nonLists
}
function buildListParagraphs(node: ElNode, depth: number, arabicPath: number[], out: (Paragraph | Table)[]): void {
  const ordered = node.tag === 'ol'
  const style = ordered ? listStyleOf(node) : 'legal'
  let idx = 0
  for (const li of node.children) {
    if (li.type !== 'el' || li.tag !== 'li') continue
    idx++
    const path = [...arabicPath, idx]
    const prefix = ordered ? orderedPrefix(style, path, idx) : (depth === 0 ? '•  ' : '–  ')
    out.push(new Paragraph({
      children: [new TextRun({ text: prefix }), ...collectRuns(listItemInline(li))],
      alignment: AlignmentType.JUSTIFIED,
      indent: { left: 480 + depth * 360, hanging: 240 },
      spacing: { after: 40 },
    }))
    // Вложенные списки пункта — с новым уровнем; для нумерации путь = путь пункта.
    for (const sub of li.children) {
      if (sub.type === 'el' && (sub.tag === 'ul' || sub.tag === 'ol')) {
        buildListParagraphs(sub, depth + 1, path, out)
      }
    }
  }
}

/** Преобразует список блочных узлов в массив docx-параграфов/таблиц. */
// Абзац основного текста: выключка по ширине, красная строка (~1,25 см) и
// межстрочный интервал 1,5 — так документ выглядит как аккуратно свёрстанный
// договор, а не «стена текста». Заголовки/таблицы/реквизиты идут своим путём.
const BODY_FIRST_LINE = 709 // twips ≈ 1,25 см
const BODY_LINE_SPACING = 276 // 240 = одинарный, 276 ≈ 1,15, 360 = 1,5

/** Плоский текст узла (для строк, где нужен таб между частями). */
function nodeText(n: Node): string {
  if (n.type === 'text') return n.text ?? ''
  return (n.children ?? []).map(nodeText).join('')
}
/**
 * Абзац тела документа. В «компактном» режиме (блок реквизитов и подписей)
 * убираем красную строку и выравнивание по ширине: в узкой колонке отступ
 * первой строки ломает столбик «ИНН / БИК / Р-счёт», а justify растягивает
 * строку подписи «_____ / _____» на всю ширину ячейки.
 */
function bodyParagraph(runs: TextRun[], align?: DocxAlign, compact = false): Paragraph {
  if (compact) {
    return new Paragraph({
      children: runs,
      alignment: align ?? AlignmentType.LEFT,
      spacing: { after: 60, line: BODY_LINE_SPACING },
    })
  }
  return new Paragraph({
    children: runs,
    alignment: align ?? AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: BODY_LINE_SPACING },
    indent: { firstLine: BODY_FIRST_LINE },
  })
}

// Начало приложения/допсоглашения («Приложение № 1», «Дополнительное соглашение № 2»).
// Такие части документа принято начинать с новой страницы.
// NB: \b не работает с кириллицей в JS-regex — сравниваем по началу строки.
function isAttachmentStart(text: string): boolean {
  const t = text.trim()
  if (t.length > 60) return false
  return /^(приложение|дополнительное\s+соглашение|доп\.?\s*соглашение)\s*(№|N|#)?\s*\d/i.test(t)
}

// Счётчик обработанных блоков документа: нужен, чтобы не ставить разрыв страницы
// перед САМЫМ первым блоком (иначе документ-приложение начинался бы с пустой страницы).
// Сбрасывается в convertToDocx.
let processedBlocks = 0

function buildBlocks(nodes: Node[], compact = false): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []

  for (const n of nodes) {
    if (n.type === 'text') {
      // Переводы строк/пробелы между блочными тегами (например "\n" между
      // <p>...</p>\n<p>...</p>) — это не отдельный абзац, а просто форматирование
      // исходного HTML. Без этой проверки на каждый перевод строки создаётся
      // пустой абзац с одним пробелом, и интервалы между пунктами визуально удваиваются.
      if (!n.text.trim()) continue
      const runs = collectRuns([n])
      if (!isBlank(runs)) out.push(bodyParagraph(runs, undefined, compact))
      continue
    }

    const isDocumentStart = processedBlocks === 0
    processedBlocks++

    switch (n.tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': {
        const { heading, align } = headingFor(n.tag)
        out.push(new Paragraph({
          children: collectRuns(n.children, { bold: true }),
          heading, alignment: alignFromClass(n.attribs['class']) ?? align, spacing: { before: 220, after: 100 },
          // Приложение/допсоглашение начинаем с новой страницы
          pageBreakBefore: !isDocumentStart && isAttachmentStart(nodeText(n)),
        }))
        break
      }
      case 'p': {
        // Строка «город … дата» преамбулы: город слева, дата справа (правый таб-стоп).
        if ((n.attribs['class'] ?? '').includes('doc-preamble-meta')) {
          const spans = n.children.filter((c): c is ElNode => c.type === 'el')
          const cityTxt = (spans[0] ? nodeText(spans[0]) : nodeText(n)).trim()
          const dateTxt = spans[1] ? nodeText(spans[1]).trim() : ''
          out.push(new Paragraph({
            spacing: { after: 120, line: BODY_LINE_SPACING },
            tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
            children: [new TextRun({ text: dateTxt ? `${cityTxt}\t${dateTxt}` : cityTxt })],
          }))
          break
        }
        // «Приложение № N» обычным абзацем — оформляем как заголовок части
        // документа: с новой страницы, по центру, жирным.
        const pText = nodeText(n)
        if (isAttachmentStart(pText)) {
          out.push(new Paragraph({
            children: collectRuns(n.children, { bold: true }),
            alignment: AlignmentType.CENTER,
            spacing: { before: 220, after: 100, line: BODY_LINE_SPACING },
            pageBreakBefore: !isDocumentStart,
          }))
          break
        }
        const runs = collectRuns(n.children)
        out.push(bodyParagraph(runs, alignFromClass(n.attribs['class']), compact))
        break
      }
      case 'ul': case 'ol': {
        // Рекурсивно, с многоуровневой нумерацией (1., 1.1., 1.1.1.) — как в предпросмотре.
        buildListParagraphs(n, 0, [], out)
        break
      }
      case 'table': {
        const tableCls = n.attribs['class'] ?? ''
        if (tableCls.includes('doc-requisites-table')) {
          out.push(buildRequisitesTableFromCells(n))
        } else {
          out.push(buildTable(n))
        }
        break
      }
      case 'hr': {
        out.push(new Paragraph({ text: '', border: { bottom: { ...SINGLE_BORDER, space: 1 } }, spacing: { before: 120, after: 120 } }))
        break
      }
      case 'div': {
        // Реквизиты/подписи — 2-колоночная таблица без рамок.
        // doc-requisites — наш системный блок; doc-layout-table — реквизиты из
        // загруженного Word (mammoth разворачивает layout-таблицу в такой div).
        // Без этой ветки колонки схлопывались в один столбик.
        const cls = n.attribs['class'] ?? ''
        if (cls.includes('doc-requisites') || cls.includes('doc-layout-table')) {
          // Заголовок блока («РЕКВИЗИТЫ И ПОДПИСИ СТОРОН» — h1-h4 внутри div)
          // рендерим отдельным абзацем: buildRequisitesTable собирает только
          // div-колонки и иначе заголовок терялся в Word.
          const titleEl = n.children.find(
            (c): c is ElNode => c.type === 'el' && /^h[1-4]$/.test(c.tag),
          )
          if (titleEl) out.push(...buildBlocks([titleEl]))
          out.push(buildRequisitesTable(n))
        } else {
          out.push(...buildBlocks(n.children, compact))
        }
        break
      }
      default:
        out.push(...buildBlocks(n.children))
    }
  }

  return out
}

/** Содержимое ячейки → массив параграфов. */
function cellParagraphs(cell: ElNode, headerBold: boolean): Paragraph[] {
  // Если внутри есть <p> — каждый абзац отдельно; иначе один абзац из инлайн-контента
  const ps = cell.children.filter((c): c is ElNode => c.type === 'el' && c.tag === 'p')
  if (ps.length > 0) {
    return ps.map(p => new Paragraph({ children: collectRuns(p.children, headerBold ? { bold: true } : {}) }))
  }
  const runs = collectRuns(cell.children, headerBold ? { bold: true } : {})
  return [new Paragraph({ children: runs.length ? runs : [new TextRun('')] })]
}

function buildTable(table: ElNode): Table {
  // Собираем все <tr> (из thead/tbody/tfoot или напрямую)
  const rows: ElNode[] = []
  const collectRows = (node: ElNode) => {
    for (const c of node.children) {
      if (c.type !== 'el') continue
      if (c.tag === 'tr') rows.push(c)
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collectRows(c)
    }
  }
  collectRows(table)

  // Число колонок = макс. эффективная ширина строки (с учётом colspan)
  let cols = 0
  for (const tr of rows) {
    let w = 0
    for (const cell of tr.children) {
      if (cell.type === 'el' && (cell.tag === 'td' || cell.tag === 'th')) {
        w += parseInt(cell.attribs['colspan'] ?? '1', 10) || 1
      }
    }
    cols = Math.max(cols, w)
  }
  if (cols === 0) cols = 1

  const colWidth = Math.floor(CONTENT_WIDTH / cols)

  const docRows = rows.map(tr => {
    const cells: TableCell[] = []
    for (const cell of tr.children) {
      if (cell.type !== 'el' || (cell.tag !== 'td' && cell.tag !== 'th')) continue
      const colSpan = parseInt(cell.attribs['colspan'] ?? '1', 10) || 1
      const rowSpan = parseInt(cell.attribs['rowspan'] ?? '1', 10) || 1
      cells.push(new TableCell({
        children: cellParagraphs(cell, cell.tag === 'th'),
        borders: CELL_BORDERS,
        width: { size: colWidth * colSpan, type: WidthType.DXA },
        columnSpan: colSpan > 1 ? colSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
      }))
    }
    return new TableRow({ children: cells })
  })

  return new Table({
    rows: docRows,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: Array(cols).fill(colWidth),
  })
}

/**
 * Блок реквизитов, пришедший из редактора в виде таблицы (table.doc-requisites-table).
 * Рисуем теми же правилами, что и вариант с колонками-div: без рамок, компактные
 * абзацы. Иначе Word показал бы обычную таблицу с сеткой.
 */
function buildRequisitesTableFromCells(table: ElNode): Table {
  const cellNodes: ElNode[] = []
  const walk = (nodes: Node[]) => {
    for (const c of nodes) {
      if (c.type !== 'el') continue
      if (c.tag === 'td' || c.tag === 'th') cellNodes.push(c)
      else walk(c.children)
    }
  }
  walk(table.children)

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  // insideHorizontal/insideVertical обязательны: без них Word ставит внутренние
  // границы по умолчанию и между колонками реквизитов появляется линия.
  const noBorders = {
    top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
    insideHorizontal: noBorder, insideVertical: noBorder,
  }
  const columns = cellNodes.length ? cellNodes : [table]
  const colWidth = Math.floor(CONTENT_WIDTH / columns.length)

  const cells = columns.map((col) => new TableCell({
    children: buildBlocks(col.children, true).filter((b): b is Paragraph => b instanceof Paragraph),
    borders: noBorders,
    width: { size: colWidth, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 120 },
  }))

  return new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: Array(columns.length).fill(colWidth),
    borders: noBorders,
  })
}

/** Блок реквизитов (div.doc-requisites c колонками) → 2-колоночная таблица без рамок. */
function buildRequisitesTable(div: ElNode): Table {
  const colDivs = div.children.filter((c): c is ElNode => c.type === 'el' && c.tag === 'div')
  const columns = colDivs.length ? colDivs : [div]
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  // insideHorizontal/insideVertical обязательны: без них Word ставит внутренние
  // границы по умолчанию и между колонками реквизитов появляется линия.
  const noBorders = {
    top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
    insideHorizontal: noBorder, insideVertical: noBorder,
  }
  const colWidth = Math.floor(CONTENT_WIDTH / columns.length)

  const cells = columns.map(col => new TableCell({
    children: buildBlocks(col.children, true).filter((b): b is Paragraph => b instanceof Paragraph),
    borders: noBorders,
    width: { size: colWidth, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 120 },
  }))

  return new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: Array(columns.length).fill(colWidth),
    borders: noBorders,
  })
}

// ─── Точка входа ────────────────────────────────────────────────────────────

/**
 * Принимает markdown или HTML, отдаёт Buffer валидного DOCX.
 */
// ─── Блок реквизитов и подписей ───────────────────────────────────────────────

function reqLine(label: string, value?: string | null): Paragraph | null {
  if (!value) return null
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 276 },
    children: [
      new TextRun({ text: `${label}: `, font: 'Times New Roman', size: 24 }),
      new TextRun({ text: value, font: 'Times New Roman', size: 24 }),
    ],
  })
}

function buildPartyBlock(party: RequisitesParty, title: string, signaturesOnly = false): Paragraph[] {
  const isIP = party.type === 'SOLE_PROPRIETOR'
  const isIndividual = party.type === 'INDIVIDUAL'
  const hasKpp = !isIP && !isIndividual

  const shortName = (fullName?: string | null) => {
    if (!fullName) return '___________'
    // У ИП имя хранится с префиксом «ИП Фамилия Имя Отчество» — отбрасываем
    // префикс, иначе «ИП» попадает в позицию фамилии и портит инициалы.
    const withoutPrefix = fullName.trim().replace(/^ИП\s+/i, '')
    const parts = withoutPrefix.split(/\s+/)
    if (parts.length < 2) return withoutPrefix
    return parts[0] + ' ' + parts.slice(1).map((w) => w[0] + '.').join('')
  }

  // Для приложений и доп. соглашений — только подписи: название стороны + ФИО,
  // без ИНН/счетов/банка. Полные реквизиты приводятся только в самом договоре.
  const requisiteLines: (Paragraph | null)[] = signaturesOnly ? [] : [
    // Адрес
    party.legalAddress ? new Paragraph({
      spacing: { before: 0, after: 60, line: 276 },
      children: [new TextRun({ text: party.legalAddress, font: 'Times New Roman', size: 24 })],
    }) : null,
    // Реквизиты
    reqLine('ИНН', party.inn),
    hasKpp ? reqLine('КПП', party.kpp) : null,
    isIP ? reqLine('ОГРНИП', party.ogrn) : (!isIndividual ? reqLine('ОГРН', party.ogrn) : null),
    reqLine('Р/счёт', party.checkingAccount),
    reqLine('К/счёт', party.correspondentAccount),
    reqLine('Банк', party.bankName),
    reqLine('БИК', party.bik),
    isIP ? reqLine('E-mail', party.email) : null,
  ]

  const lines: (Paragraph | null)[] = [
    // Заголовок (Заказчик / Исполнитель)
    new Paragraph({
      spacing: { before: 240, after: 80, line: 276 },
      children: [new TextRun({ text: title, font: 'Times New Roman', size: 24, bold: true, allCaps: true })],
    }),
    // Название: для ИП — всегда с префиксом «ИП», если его ещё нет в строке
    new Paragraph({
      spacing: { before: 0, after: 60, line: 276 },
      children: [new TextRun({
        text: isIP
          ? (/^ИП\s/i.test(party.name ?? '') ? (party.name ?? '—') : `ИП ${party.name ?? '—'}`)
          : (party.name ?? '—'),
        font: 'Times New Roman', size: 24, bold: true,
      })],
    }),
    ...requisiteLines,
    // Строка подписи: для ООО — должность подписанта отдельным абзацем перед чертой;
    // для ИП — «ИП» включён в имя выше, отдельный абзац не нужен (он был избыточным).
    !isIP ? new Paragraph({
      spacing: { before: 200, after: 0, line: 276 },
      children: [new TextRun({
        text: party.signatorPosition ?? 'Генеральный директор',
        font: 'Times New Roman', size: 24,
      })],
    }) : null,
    new Paragraph({
      spacing: { before: isIP ? 200 : 60, after: 0, line: 276 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA', space: 2 } },
      children: [new TextRun({ text: '', font: 'Times New Roman', size: 24 })],
    }),
    // Инициалы подписанта — для ИП из имени, для ООО из данных подписанта
    new Paragraph({
      spacing: { before: 40, after: 0, line: 276 },
      children: [new TextRun({
        text: isIP ? shortName(party.name) : (party.signatorName ? shortName(party.signatorName) : ''),
        font: 'Times New Roman', size: 24,
      })],
    }),
  ]

  return lines.filter(Boolean) as Paragraph[]
}

function buildRequisitesBlock(opts: NonNullable<DocxOptions['requisites']>, sectionNumber: number): (Paragraph | Table)[] {
  // Приложение/ДС — только подписи сторон, без полных реквизитов
  const signaturesOnly = opts.docType === 'APPENDIX' || opts.docType === 'AMENDMENT'
  const sectionTitle = signaturesOnly ? 'Подписи сторон' : 'Реквизиты и подписи сторон'
  const heading = `${sectionNumber}. ${sectionTitle}`

  // Две стороны — в два столбца (таблица без видимых рамок).
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const cellBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
  const colWidth = Math.floor(CONTENT_WIDTH / 2)

  const partyCell = (party: RequisitesParty, title: string) =>
    new TableCell({
      width: { size: colWidth, type: WidthType.DXA },
      borders: cellBorders,
      margins: { top: 0, bottom: 0, left: 80, right: 80 },
      children: buildPartyBlock(party, title, signaturesOnly),
    })

  const table = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [colWidth, colWidth],
    borders: {
      top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
      insideHorizontal: noBorder, insideVertical: noBorder,
    },
    rows: [
      new TableRow({
        children: [
          partyCell(opts.left, opts.leftTitle),
          partyCell(opts.right, opts.rightTitle),
        ],
      }),
    ],
  })

  return [
    // Нумерованный заголовок раздела (без верхней черты)
    new Paragraph({
      spacing: { before: 360, after: 120 },
      children: [new TextRun({ text: heading, font: 'Times New Roman', size: 24, bold: true, allCaps: true })],
    }),
    table,
  ]
}

/**
 * Определяет номер следующего раздела по тексту документа.
 * Ищет заголовки вида «N. Название» (верхний уровень, без подпунктов «N.M»)
 * и берёт максимум — финальный раздел получит номер max + 1.
 * Работает и для сгенерированных (<h2>), и для загруженных (<p>) документов.
 */
function detectNextSectionNumber(html: string): number {
  let max = 0
  const blockRe = /<(h[1-3]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    const text = (m[2] ?? '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim()
    // «13. Место...» — да; «13.1. ...» — нет (это подпункт)
    const num = text.match(/^(\d{1,2})\.\s+(?!\d)/)
    if (num) {
      const n = parseInt(num[1]!, 10)
      if (n > max && n < 60) max = n
    }
  }
  return max + 1
}

/**
 * Вырезает из тела документа блок реквизитов/подписей, если он там есть
 * (например, у загруженного из Word договора или если ИИ его всё же добавил).
 * Реквизиты в финал документа всегда ставит система — дубля быть не должно.
 *
 * Детект по двум признакам:
 *  A) заголовок раздела реквизитов/подписей (плоские <p> у mammoth-документов);
 *  B) последняя <table> с ключевыми словами реквизитов.
 * Берём самую раннюю точку среза — от неё до конца документа всё удаляем.
 */
/**
 * Есть ли ПОСЛЕ позиции fromIdx новые разделы или приложения. Если да — найденный
 * «блок реквизитов» стоит в середине документа, и резать от него до конца нельзя:
 * улетят приложения (регресс уже ловили в splitRequisitesBlock — там та же защита).
 * NB: \b не работает с кириллицей в JS-regex — используем lookahead.
 */
function hasSectionsAfter(html: string, fromIdx: number): boolean {
  const tail = html.slice(fromIdx)
  const blockRe = /<(h[1-4]|p)[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(tail))) {
    const t = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (/^(приложение|дополнительное\s+соглашение|доп\.?\s*соглашение|спецификация)(?=\s|№|\d|:|$)/i.test(t)) return true
    if (/^\d{1,2}[.)]\s*[А-ЯЁA-Z]/.test(t)) return true
  }
  return false
}

function stripRequisitesSection(html: string): string {
  const REQS_RE = /ИНН|Р\/сч|р\/сч|ОГРН|БИК|К\/сч|к\/сч/i
  // Заголовки финального раздела. ВАЖНО: \w и \b в JS не работают с кириллицей
  // (только ASCII), поэтому продолжения слов задаём явным классом [а-яё]*.
  // Примеры: «Реквизиты сторон», «Реквизиты и подписи сторон», «Подписи сторон»,
  // «Место нахождения и банковские реквизиты», «Адреса и реквизиты сторон».
  const TITLE_RES: RegExp[] = [
    /место\s+нахождени[а-яё]*\s+и\s+(?:банковск[а-яё]*\s+)?реквизит/i,
    /адрес[а-яё]*\s+и\s+реквизит/i,
    /банковск[а-яё]*\s+реквизит/i,
    /реквизит[а-яё]*\s+и\s+подписи\s+сторон/i,
    /реквизит[а-яё]*\s+сторон/i,
    /подписи\s+сторон/i,
    /^реквизиты\s*$/i, // отдельный заголовок «Реквизиты»
  ]

  let cut = -1

  // ── A: заголовок раздела реквизитов/подписей (плоские <p> или <h2>) ──
  // Берём ПОСЛЕДНЕЕ совпадение — раздел всегда в конце документа.
  const blockRe = /<(h[1-3]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    const text = (m[2] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&[^;]+;/g, ' ')
      .replace(/^\s*\d{1,2}\s*[.)]\s*/, '') // отбрасываем ведущий номер «13.»
      .trim()
    if (!TITLE_RES.some((re) => re.test(text))) continue
    // Раздел реквизитов в СЕРЕДИНЕ документа (после него приложения/разделы) —
    // резать от него до конца нельзя, улетели бы приложения.
    if (hasSectionsAfter(html, m.index + m[0].length)) continue
    cut = m.index
  }

  // ── B: последняя <table> с реквизитами ──
  const tableMatches = [...html.matchAll(/<table[\s>]/gi)]
  const lastTable = tableMatches[tableMatches.length - 1]
  if (lastTable) {
    const tableStart = lastTable.index
    const tableEndIdx = html.lastIndexOf('</table>')
    if (tableEndIdx > tableStart) {
      const tableHtml = html.slice(tableStart, tableEndIdx)
      if (
        REQS_RE.test(tableHtml) &&
        (cut === -1 || tableStart < cut) &&
        !hasSectionsAfter(html, tableEndIdx + '</table>'.length)
      ) {
        cut = tableStart
      }
    }
  }

  if (cut === -1) return html
  return html.slice(0, cut).trimEnd()
}

/**
 * Вырезает «шапку» документа — всё до первого нумерованного раздела «1. …».
 * Используется, когда преамбулу строит система: шаблонный заголовок и абзац со
 * сторонами (часто с прочерками) удаляются, а сверху ставится сгенерированный.
 * Если раздел «1.» не найден — документ не трогаем (возвращаем как есть).
 */
function stripLeadingPreamble(html: string): string {
  const blockRe = /<(h[1-3]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    const text = (m[2] ?? '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim()
    // «1. Предмет…» — да; «1.1.» или «1.» с цифрой дальше — нет
    if (/^1\s*[.)]\s+(?!\d)\S/.test(text)) return html.slice(m.index)
  }
  return html
}

/** Полное наименование стороны с организационно-правовой формой. */
function partyFullName(party: RequisitesParty): string {
  const name = (party.name ?? '____________').trim()
  if (party.type === 'SOLE_PROPRIETOR') {
    return /^(ИП|Индивидуальный)/i.test(name) ? name.replace(/^ИП\s+/i, 'Индивидуальный предприниматель ') : `Индивидуальный предприниматель ${name}`
  }
  return name
}

/** Основание полномочий: для ИП — ОГРНИП, для компании — Устав. */
function partyBasis(party: RequisitesParty): string {
  if (party.type === 'SOLE_PROPRIETOR') {
    return party.ogrn ? `ОГРНИП ${party.ogrn}` : 'свидетельства о государственной регистрации'
  }
  return 'Устава'
}

/** Должность в родительный падеж для оборота «в лице …»: частые случаи. */
function positionGenitive(position?: string | null): string {
  const p = (position ?? '').trim()
  if (!p) return 'Генерального директора'
  const adj: Record<string, string> = {
    'генеральный': 'Генерального', 'исполнительный': 'Исполнительного',
    'финансовый': 'Финансового', 'коммерческий': 'Коммерческого', 'технический': 'Технического',
  }
  const m = p.match(/^(\S+)\s+директор$/i)
  if (m) {
    const a = adj[(m[1] ?? '').toLowerCase()]
    if (a) return `${a} директора`
  }
  if (/^директор$/i.test(p)) return 'Директора'
  return p // нестандартную должность оставляем как есть
}

/** Фраза одной стороны для преамбулы. */
function partyPhrase(party: RequisitesParty, role: string): string {
  const basis = partyBasis(party)
  if (party.type === 'SOLE_PROPRIETOR') {
    const fio = party.signatorName?.trim() || party.name?.replace(/^ИП\s+/i, '').trim() || '____________'
    return `Индивидуальный предприниматель ${fio}, именуемый в дальнейшем «${role}», действующий на основании ${basis}`
  }
  const position = positionGenitive(party.signatorPosition)
  const fio = party.signatorName?.trim() || '____________'
  return `${partyFullName(party)} в лице ${position} ${fio}, действующего на основании ${basis}, именуемое в дальнейшем «${role}»`
}

function buildPreambleBlock(p: NonNullable<DocxOptions['preamble']>): Paragraph[] {
  const titleText = p.docNumber ? `${p.docTitle} № ${p.docNumber}` : p.docTitle
  const city = `г. ${p.city?.trim() || 'Москва'}`
  const date = p.date?.trim() || '«___» ____________ 202__ г.'

  const preambleText =
    `${partyPhrase(p.customer, 'Заказчик')}, с одной стороны, и ` +
    `${partyPhrase(p.executor, 'Исполнитель')}, с другой стороны, ` +
    `совместно именуемые «Стороны», заключили настоящий Договор (далее — «Договор») о нижеследующем:`

  return [
    // Заголовок документа — по центру, жирный
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80, line: 276 },
      children: [new TextRun({ text: titleText, font: 'Times New Roman', size: 28, bold: true })],
    }),
    // Город слева / дата справа (через таб)
    new Paragraph({
      spacing: { before: 0, after: 200, line: 276 },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
      children: [new TextRun({ text: `${city}\t${date}`, font: 'Times New Roman', size: 24 })],
    }),
    // Абзац со сторонами — по ширине
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 0, after: 200, line: 276 },
      indent: { firstLine: 567 }, // отступ первой строки ~1 см
      children: [new TextRun({ text: preambleText, font: 'Times New Roman', size: 24 })],
    }),
  ]
}

export async function convertToDocx(content: string, opts: DocxOptions = {}): Promise<Buffer> {
  const isHtml = /<(p|h[1-6]|table|ul|ol|div|strong)\b/i.test(content.slice(0, 500))

  let html: string
  if (isHtml) {
    html = content.trim()
  } else {
    marked.setOptions({ gfm: true })
    html = (marked.parse(content.trim()) as string)
  }

  // Преамбулу (шапку) при наличии тоже ставит система — вырезаем шаблонную
  // шапку до раздела «1. …» и подставим сгенерированную сверху.
  if (opts.preamble) {
    html = stripLeadingPreamble(html)
  }

  // Реквизиты/подписи в финал всегда ставит система — вырезаем любой такой
  // блок из тела (загруженные из Word договоры приносят свой), чтобы не было дубля.
  if (opts.requisites) {
    html = stripRequisitesSection(html)
  }

  const nodes = parseHtml(html)
  processedBlocks = 0 // чтобы разрыв страницы не встал перед первым блоком документа
  const children = buildBlocks(nodes)
  if (children.length === 0) children.push(new Paragraph({ children: [new TextRun('')] }))

  if (opts.preamble) {
    children.unshift(...buildPreambleBlock(opts.preamble))
  }

  if (opts.requisites) {
    const sectionNumber = detectNextSectionNumber(html)
    children.push(...buildRequisitesBlock(opts.requisites, sectionNumber))
  }

  const doc = new Document({
    title: opts.title ?? 'Договор',
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: 24 } } },
      paragraphStyles: [
        // color обязателен: без него Word и просмотрщики (docx-preview) берут цвет
        // встроенной темы для Heading — заголовки разделов выходили синими.
        // В договоре весь текст чёрный, поэтому фиксируем явно.
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Times New Roman', allCaps: true, color: '000000' },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: 'Times New Roman', allCaps: true, color: '000000' },
          paragraph: { spacing: { before: 120, after: 60 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Times New Roman', color: '000000' },
          paragraph: { spacing: { before: 100, after: 60 }, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: {
            top: opts.margins?.top ?? 1134,
            right: opts.margins?.right ?? 850,
            bottom: opts.margins?.bottom ?? 1134,
            left: opts.margins?.left ?? 1701,
          },
        },
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
