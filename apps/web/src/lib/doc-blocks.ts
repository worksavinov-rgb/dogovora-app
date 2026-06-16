/**
 * doc-blocks.ts — блочное редактирование HTML-документа через ИИ.
 *
 * Идея: документ режется на блоки верхнего уровня (<h2>, <p>, <table>, <ol>…),
 * каждому блоку присваивается номер. ИИ возвращает операции над блоками
 * (REPLACE / INSERT_AFTER / DELETE) с готовым HTML. Блоки, которые ИИ не трогал,
 * физически не могут испортиться. Каждый возвращённый блок валидируется
 * (баланс тегов, структура таблиц) — невалидная правка отклоняется целиком.
 *
 *  splitHtmlBlocks()   — HTML → массив блоков верхнего уровня
 *  blocksToPromptText()— блоки → нумерованный текст для промпта
 *  parseBlockOps()     — ответ ИИ → операции
 *  validateHtmlFragment() — проверка валидности HTML-фрагмента
 *  applyBlockOps()     — применение операций к блокам
 *  BLOCK_EDIT_INSTRUCTION — системная инструкция для ИИ
 */

// ─── Разбиение на блоки ───────────────────────────────────────────────────────

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col'])

const TAG_RE = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?\/?>/g

/**
 * Режет HTML на блоки верхнего уровня.
 * Учитывает вложенность (таблица с вложенными тегами — один блок).
 * Текст вне тегов на верхнем уровне становится отдельным блоком.
 */
export function splitHtmlBlocks(htmlInput: string): string[] {
  // Документы, загруженные из Word (через mammoth), приходят обёрнутыми в
  // <html><head>…</head><body>…</body></html>. Без снятия обёртки вся «начинка»
  // оказывается внутри одного блока <html> — нарезка по блокам ломается, и любая
  // правка заменяет весь документ. Снимаем обёртку перед разбиением.
  const html = htmlInput
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .trim()

  const blocks: string[] = []
  let depth = 0
  let blockStart = 0
  let lastEnd = 0

  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(html)) !== null) {
    const isClose = !!m[1]
    const tag = m[2]!.toLowerCase()
    const selfClosing = VOID_TAGS.has(tag) || m[0].endsWith('/>')

    if (depth === 0 && !isClose) {
      // Текст между блоками — отдельный блок (если непустой)
      const between = html.slice(lastEnd, m.index)
      if (between.trim()) blocks.push(between.trim())
      blockStart = m.index
    }

    if (selfClosing) {
      if (depth === 0) {
        blocks.push(html.slice(m.index, TAG_RE.lastIndex))
        lastEnd = TAG_RE.lastIndex
      }
      continue
    }

    if (!isClose) {
      depth++
    } else {
      depth = Math.max(0, depth - 1)
      if (depth === 0) {
        blocks.push(html.slice(blockStart, TAG_RE.lastIndex).trim())
        lastEnd = TAG_RE.lastIndex
      }
    }
  }

  const tail = html.slice(lastEnd)
  if (tail.trim()) blocks.push(tail.trim())

  return blocks.filter(b => b.length > 0)
}

/** Блоки → нумерованный текст для промпта: 〔1〕<h2>…</h2> */
export function blocksToPromptText(blocks: string[]): string {
  return blocks.map((b, i) => `〔${i + 1}〕${b}`).join('\n')
}

// ─── Операции ─────────────────────────────────────────────────────────────────

export interface BlockOp {
  type: 'replace' | 'insert_after' | 'delete'
  from: number   // 1-based номер блока (счёт ИИ — может быть неточным)
  to: number     // для replace/delete диапазона; = from если один блок
  html: string   // новый HTML (пустой для delete)
  anchor?: string // цитата начала исходного блока — надёжнее чем счёт номеров
}

/**
 * Парсит ответ ИИ на операции.
 * Формат:
 *   <<<REPLACE 5 "первые слова исходного блока">>> … <<<END>>>
 *   <<<REPLACE 5-7 "первые слова блока 5">>> … <<<END>>>
 *   <<<INSERT_AFTER 12 "первые слова блока 12">>> … <<<END>>>
 *   <<<DELETE 3 "первые слова блока 3">>> или <<<DELETE 3-4 "...">>>
 * Цитата в кавычках опциональна, но если есть — используется для поиска
 * блока по содержимому (надёжнее чем номер, который ИИ может насчитать неверно).
 */
export function parseBlockOps(aiResponse: string): BlockOp[] {
  const ops: BlockOp[] = []
  const re = /<{2,4}\s*(REPLACE|INSERT_AFTER|DELETE)\s+(\d+)(?:\s*[-–—]\s*(\d+))?\s*(?:"([^"]{0,200})")?\s*>{2,4}([\s\S]*?)(?=<{2,4}\s*(?:REPLACE|INSERT_AFTER|DELETE|END)|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(aiResponse)) !== null) {
    const type = m[1]!.toLowerCase() as BlockOp['type']
    const from = parseInt(m[2]!, 10)
    const to = m[3] ? parseInt(m[3], 10) : from
    const anchor = m[4]?.trim() || undefined
    let html = (m[5] ?? '').replace(/<{2,4}\s*END\s*>{2,4}/gi, '').trim()
    // Убираем возможные markdown-ограждения
    html = html.replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim()
    ops.push({ type, from, to: Math.max(from, to), html, anchor })
  }
  return ops
}

// ─── Валидация HTML-фрагмента ─────────────────────────────────────────────────

const ALLOWED_FRAGMENT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
  'div', 'span', 'blockquote',
])

// Где разрешён каждый табличный тег
const TABLE_PARENT: Record<string, Set<string>> = {
  tr: new Set(['table', 'thead', 'tbody', 'tfoot']),
  td: new Set(['tr']),
  th: new Set(['tr']),
  thead: new Set(['table']),
  tbody: new Set(['table']),
  tfoot: new Set(['table']),
}

export interface ValidationResult {
  ok: boolean
  error?: string
}

/**
 * Проверяет HTML-фрагмент:
 * 1) теги сбалансированы (стек открытий/закрытий)
 * 2) только разрешённые теги
 * 3) табличные теги стоят в правильных родителях
 * 4) нет markdown-таблиц и markdown-заголовков в тексте
 */
export function validateHtmlFragment(html: string): ValidationResult {
  if (!html.trim()) return { ok: true }

  // Markdown-маркеры вне тегов — признак что ИИ сорвался в markdown
  const textOnly = html.replace(/<[^>]+>/g, ' ')
  if (/(^|\n)\s*\|.*\|.*\|/m.test(textOnly)) {
    return { ok: false, error: 'markdown-таблица вместо <table>' }
  }
  if (/(^|\n)\s*#{1,4}\s+\S/m.test(textOnly)) {
    return { ok: false, error: 'markdown-заголовок вместо <h2>' }
  }

  const stack: string[] = []
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(html)) !== null) {
    const isClose = !!m[1]
    const tag = m[2]!.toLowerCase()
    const selfClosing = VOID_TAGS.has(tag) || m[0].endsWith('/>')

    if (!ALLOWED_FRAGMENT_TAGS.has(tag)) {
      return { ok: false, error: `запрещённый тег <${tag}>` }
    }
    if (selfClosing) continue

    if (!isClose) {
      const parent = stack[stack.length - 1]
      const allowedParents = TABLE_PARENT[tag]
      if (allowedParents && (!parent || !allowedParents.has(parent))) {
        return { ok: false, error: `<${tag}> вне ${[...allowedParents].join('/')}` }
      }
      stack.push(tag)
    } else {
      const expected = stack.pop()
      if (expected !== tag) {
        return { ok: false, error: `незакрытый тег: ожидался </${expected ?? '?'}>, получен </${tag}>` }
      }
    }
  }

  if (stack.length > 0) {
    return { ok: false, error: `незакрытые теги: ${stack.join(', ')}` }
  }
  return { ok: true }
}

// ─── Применение операций ──────────────────────────────────────────────────────

export interface ApplyBlocksResult {
  html: string
  applied: number
  rejected: number
  errors: string[]
}

/**
 * Применяет операции к блокам. Невалидные операции (битый HTML,
 * номер блока вне диапазона) отклоняются, остальные применяются.
 * Операции применяются от конца к началу, чтобы номера не сдвигались.
 */
export function applyBlockOps(blocks: string[], ops: BlockOp[]): ApplyBlocksResult {
  const result = [...blocks]
  let applied = 0
  let rejected = 0
  const errors: string[] = []

  // Сначала пытаемся найти блок по цитате (anchor) — это надёжнее, чем номер,
  // который ИИ мог насчитать неверно. Номер используется только если anchor
  // не указан или не найден в документе.
  //
  // ВАЖНО: диапазон (to - from), который насчитал сам ИИ, доверять нельзя —
  // именно эта ошибка (спутал номер пункта договора с диапазоном блоков,
  // например "пункт 3.2" → "блоки 3-40") приводила к тому, что правка
  // одного абзаца стирала почти весь документ. После того как anchor нашёл
  // правильный блок, ограничиваем диапазон небольшим максимумом — этого
  // достаточно для типовых множественных правок (несколько соседних
  // абзацев, таблица), но не даёт случайно затронуть весь документ.
  const MAX_ANCHOR_SPAN = 3
  const resolved = ops.map(op => {
    if (!op.anchor) return op
    const idx = findBlockByAnchor(blocks, op.anchor)
    if (idx === -1) return op
    const span = Math.min(Math.max(0, op.to - op.from), MAX_ANCHOR_SPAN)
    return { ...op, from: idx + 1, to: idx + 1 + span }
  })

  // Сортируем по убыванию from — применяем с конца
  const sorted = [...resolved].sort((a, b) => b.from - a.from)

  for (const op of sorted) {
    const fromIdx = op.from - 1
    const toIdx = op.to - 1

    if (fromIdx < 0 || toIdx >= blocks.length || fromIdx > toIdx) {
      rejected++
      errors.push(`блок ${op.from}${op.to !== op.from ? `-${op.to}` : ''} вне диапазона`)
      continue
    }

    if (op.type !== 'delete') {
      const v = validateHtmlFragment(op.html)
      if (!v.ok || !op.html.trim()) {
        rejected++
        errors.push(`${op.type} ${op.from}: ${v.error ?? 'пустой HTML'}`)
        continue
      }
    }

    const newBlocks = op.html.trim() ? splitHtmlBlocks(op.html) : []

    if (op.type === 'replace') {
      result.splice(fromIdx, toIdx - fromIdx + 1, ...newBlocks)
    } else if (op.type === 'insert_after') {
      result.splice(fromIdx + 1, 0, ...newBlocks)
    } else {
      result.splice(fromIdx, toIdx - fromIdx + 1)
    }
    applied++
  }

  return { html: result.join('\n'), applied, rejected, errors }
}

// ─── Поиск блока по цитате (anchor) ───────────────────────────────────────────

/**
 * ИИ часто путает счёт номеров блоков (особенно в длинных документах) —
 * номер пункта договора («4.2») и номер блока в массиве вообще не совпадают.
 * Чтобы не зависеть от точного счёта, просим ИИ дополнительно процитировать
 * несколько слов НАЧАЛА того блока, который он редактирует. По этой цитате
 * мы находим блок по содержимому — независимо от того, что насчитал ИИ.
 * Модель и так читает полный текст всех блоков, поэтому может найти нужное
 * место по смыслу даже если пользователь описал его общими словами,
 * не называя номер пункта.
 */
function normalizeBlockText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function findBlockByAnchor(blocks: string[], anchor: string | undefined): number {
  if (!anchor) return -1
  const target = normalizeBlockText(anchor)
  if (target.length < 4) return -1
  for (let i = 0; i < blocks.length; i++) {
    if (normalizeBlockText(blocks[i]!).includes(target)) return i
  }
  return -1
}

// ─── Инструкция для ИИ ────────────────────────────────────────────────────────

export const BLOCK_EDIT_INSTRUCTION = `
Документ разбит на пронумерованные блоки: 〔N〕<html-блок>.

Задание пользователя может быть сформулировано как угодно: с номером пункта
договора («пункт 4.2»), с цитатой текста, или просто общими словами («раздел
про оплату», «там где сроки сдачи работ»). Номер пункта договора (4.2) — это
НЕ номер блока, они никогда не совпадают, не пытайся их сопоставлять. Вместо
этого прочитай содержимое блоков ниже и сам найди нужное место по смыслу.

Возвращай ТОЛЬКО операции над блоками, без комментариев. После номера блока
в кавычках укажи первые 4–8 слов ИСХОДНОГО текста этого блока (скопируй
точно как в документе) — это нужно чтобы система нашла блок по содержимому,
даже если ты ошибся со счётом номера:

<<<REPLACE 5 "Исходные видеоматериалы передаются Заказчику">>>
<p>новый HTML блока 5</p>
<<<END>>>

<<<REPLACE 5-7 "Исходные видеоматериалы передаются Заказчику">>>
<p>HTML, заменяющий блоки 5–7 (цитата — начало блока 5)</p>
<<<END>>>

<<<INSERT_AFTER 12 "5.5. Исполнитель устраняет недостатки">>>
<h2>3. НОВЫЙ РАЗДЕЛ</h2>
<p>3.1. Текст пункта.</p>
<<<END>>>

<<<DELETE 3 "3.1. Услуги считаются оказанными">>>

ЖЁСТКИЕ ПРАВИЛА:
1. HTML внутри операции — только теги h2, h3, p, strong, em, ol, ul, li, table, thead, tbody, tr, th, td, br. Все теги закрыты.
2. ЗАПРЕЩЁН markdown: никаких **, #, |---|, \`\`\`.
3. Если правишь содержимое таблицы — верни REPLACE с номером блока таблицы и ПОЛНУЮ таблицу <table>…</table> целиком, со всеми строками (и изменёнными, и неизменёнными), сохранив структуру thead/tbody и атрибуты ячеек.
4. Не переписывай блоки, которых не касается задание.
5. Заголовки разделов — <h2>1. НАЗВАНИЕ</h2>. Пункты — <p>1.1. Текст.</p>, подпункты — <p>1.1.1. Текст.</p>. При добавлении/удалении пунктов пересчитай нумерацию затронутых пунктов (верни их через REPLACE).
6. Жирное выделение — только <strong>, не **.
7. Цитата в кавычках — это ТОЧНЫЙ фрагмент исходного текста блока, который ты редактируешь (не нового). Без неё, если ошибёшься с номером, правка не применится.

ПРИМЕР правки ячейки таблицы (изменить цену в строке 2):
<<<REPLACE 8 "№ Услуга Ед. изм. Стоимость">>>
<table><thead><tr><th>№</th><th>Услуга</th><th>Ед. изм.</th><th>Стоимость, руб.</th></tr></thead><tbody><tr><td>1</td><td>Монтаж ролика</td><td>1 ролик</td><td>2 700</td></tr><tr><td>2</td><td>Монтаж продающего ролика</td><td>1 ролик</td><td>3 500</td></tr></tbody></table>
<<<END>>>
`.trim()
