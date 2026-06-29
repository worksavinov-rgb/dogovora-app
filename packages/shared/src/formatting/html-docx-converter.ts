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
  WidthType, BorderStyle, AlignmentType, HeadingLevel, VerticalMergeType,
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

interface RunStyle { bold?: boolean; italics?: boolean }

function collectRuns(nodes: Node[], style: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      const text = n.text.replace(/\s+/g, ' ')
      if (text) runs.push(new TextRun({ text, bold: style.bold, italics: style.italics }))
      continue
    }
    if (n.tag === 'br') { runs.push(new TextRun({ break: 1 })); continue }
    if (n.tag === 'strong' || n.tag === 'b') { runs.push(...collectRuns(n.children, { ...style, bold: true })); continue }
    if (n.tag === 'em' || n.tag === 'i') { runs.push(...collectRuns(n.children, { ...style, italics: true })); continue }
    // прочие инлайн-обёртки (span и т.п.)
    runs.push(...collectRuns(n.children, style))
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
  if (tag === 'h1') return { heading: HeadingLevel.HEADING_1, align: AlignmentType.CENTER }
  if (tag === 'h2') return { heading: HeadingLevel.HEADING_2, align: AlignmentType.LEFT }
  if (tag === 'h3') return { heading: HeadingLevel.HEADING_3, align: AlignmentType.LEFT }
  return { heading: HeadingLevel.HEADING_4, align: AlignmentType.LEFT }
}

/** Преобразует список блочных узлов в массив docx-параграфов/таблиц. */
function buildBlocks(nodes: Node[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []

  for (const n of nodes) {
    if (n.type === 'text') {
      // Переводы строк/пробелы между блочными тегами (например "\n" между
      // <p>...</p>\n<p>...</p>) — это не отдельный абзац, а просто форматирование
      // исходного HTML. Без этой проверки на каждый перевод строки создаётся
      // пустой абзац с одним пробелом, и интервалы между пунктами визуально удваиваются.
      if (!n.text.trim()) continue
      const runs = collectRuns([n])
      if (!isBlank(runs)) out.push(new Paragraph({ children: runs, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60 } }))
      continue
    }

    switch (n.tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': {
        const { heading, align } = headingFor(n.tag)
        out.push(new Paragraph({
          children: collectRuns(n.children, { bold: true }),
          heading, alignment: align, spacing: { before: 120, after: 60 },
        }))
        break
      }
      case 'p': {
        const runs = collectRuns(n.children)
        out.push(new Paragraph({ children: runs, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60 } }))
        break
      }
      case 'ul': case 'ol': {
        const ordered = n.tag === 'ol'
        let idx = 0
        for (const li of n.children) {
          if (li.type === 'el' && li.tag === 'li') {
            idx++
            const prefix = ordered ? `${idx}. ` : '•  '
            out.push(new Paragraph({
              children: [new TextRun({ text: prefix }), ...collectRuns(li.children)],
              indent: { left: 480, hanging: 240 }, spacing: { after: 40 },
            }))
          }
        }
        break
      }
      case 'table': {
        out.push(buildTable(n))
        break
      }
      case 'hr': {
        out.push(new Paragraph({ text: '', border: { bottom: { ...SINGLE_BORDER, space: 1 } }, spacing: { before: 120, after: 120 } }))
        break
      }
      case 'div': {
        // doc-requisites рендерим как 2-колоночную таблицу без рамок
        if ((n.attribs['class'] ?? '').includes('doc-requisites')) {
          out.push(buildRequisitesTable(n))
        } else {
          out.push(...buildBlocks(n.children))
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

/** Блок реквизитов (div.doc-requisites c колонками) → 2-колоночная таблица без рамок. */
function buildRequisitesTable(div: ElNode): Table {
  const colDivs = div.children.filter((c): c is ElNode => c.type === 'el' && c.tag === 'div')
  const columns = colDivs.length ? colDivs : [div]
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
  const colWidth = Math.floor(CONTENT_WIDTH / columns.length)

  const cells = columns.map(col => new TableCell({
    children: buildBlocks(col.children).filter((b): b is Paragraph => b instanceof Paragraph),
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
      new TextRun({ text: `${label}: `, font: 'Times New Roman', size: 20, color: '666666' }),
      new TextRun({ text: value, font: 'Times New Roman', size: 20 }),
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
      children: [new TextRun({ text: party.legalAddress, font: 'Times New Roman', size: 20, color: '444444' })],
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
      children: [new TextRun({ text: title, font: 'Times New Roman', size: 22, bold: true, allCaps: true })],
    }),
    // Название
    new Paragraph({
      spacing: { before: 0, after: 60, line: 276 },
      children: [new TextRun({ text: party.name ?? '—', font: 'Times New Roman', size: 22, bold: true })],
    }),
    ...requisiteLines,
    // Строка подписи
    // Для ИП: просто "ИП" — имя уже указано выше, не дублируем
    // Для ООО: должность подписанта
    new Paragraph({
      spacing: { before: 200, after: 0, line: 276 },
      children: [new TextRun({
        text: isIP ? 'ИП' : (party.signatorPosition ?? 'Генеральный директор'),
        font: 'Times New Roman', size: 20,
      })],
    }),
    new Paragraph({
      spacing: { before: 60, after: 0, line: 276 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA', space: 2 } },
      children: [new TextRun({ text: '', font: 'Times New Roman', size: 20 })],
    }),
    // Инициалы подписанта — для ИП из имени, для ООО из данных подписанта
    new Paragraph({
      spacing: { before: 40, after: 0, line: 276 },
      children: [new TextRun({
        text: isIP ? shortName(party.name) : (party.signatorName ? shortName(party.signatorName) : ''),
        font: 'Times New Roman', size: 18, color: '888888',
      })],
    }),
  ]

  return lines.filter(Boolean) as Paragraph[]
}

function buildRequisitesBlock(opts: NonNullable<DocxOptions['requisites']>, sectionNumber: number): Paragraph[] {
  // Приложение/ДС — только подписи сторон, без полных реквизитов
  const signaturesOnly = opts.docType === 'APPENDIX' || opts.docType === 'AMENDMENT'
  const sectionTitle = signaturesOnly ? 'Подписи сторон' : 'Реквизиты и подписи сторон'
  const heading = `${sectionNumber}. ${sectionTitle}`

  return [
    // Разделитель сверху + нумерованный заголовок раздела
    new Paragraph({
      spacing: { before: 480, after: 120 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 8 } },
      children: [new TextRun({ text: heading, font: 'Times New Roman', size: 24, bold: true, allCaps: true })],
    }),
    // Первая сторона
    ...buildPartyBlock(opts.left, opts.leftTitle, signaturesOnly),
    // Вторая сторона
    ...buildPartyBlock(opts.right, opts.rightTitle, signaturesOnly),
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
    if (TITLE_RES.some((re) => re.test(text))) cut = m.index
  }

  // ── B: последняя <table> с реквизитами ──
  const tableMatches = [...html.matchAll(/<table[\s>]/gi)]
  const lastTable = tableMatches[tableMatches.length - 1]
  if (lastTable) {
    const tableStart = lastTable.index
    const tableEndIdx = html.lastIndexOf('</table>')
    if (tableEndIdx > tableStart) {
      const tableHtml = html.slice(tableStart, tableEndIdx)
      if (REQS_RE.test(tableHtml) && (cut === -1 || tableStart < cut)) {
        cut = tableStart
      }
    }
  }

  if (cut === -1) return html
  return html.slice(0, cut).trimEnd()
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

  // Реквизиты/подписи в финал всегда ставит система — вырезаем любой такой
  // блок из тела (загруженные из Word договоры приносят свой), чтобы не было дубля.
  if (opts.requisites) {
    html = stripRequisitesSection(html)
  }

  const nodes = parseHtml(html)
  const children = buildBlocks(nodes)
  if (children.length === 0) children.push(new Paragraph({ children: [new TextRun('')] }))

  if (opts.requisites) {
    const sectionNumber = detectNextSectionNumber(html)
    children.push(...buildRequisitesBlock(opts.requisites, sectionNumber))
  }

  const doc = new Document({
    title: opts.title ?? 'Договор',
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: 24 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Times New Roman', allCaps: true },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: 'Times New Roman', allCaps: true },
          paragraph: { spacing: { before: 120, after: 60 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Times New Roman' },
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
