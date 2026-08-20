/**
 * renumber-clauses.ts — пересчёт нумерации пунктов договора.
 *
 * Зачем: блочный движок правок (doc-blocks.ts) вставляет и удаляет пункты, но
 * НЕ трогает соседние блоки — это его главное достоинство (что не тронуто, то не
 * испортится). Побочный эффект: после вставки пункта посреди раздела номера
 * разъезжаются — у владельца новый пункт встал как «1.3», и следующий тоже
 * остался «1.3». Просить перенумерацию у модели ненадёжно, поэтому считаем сами:
 * арифметика детерминирована и проверяется тестами.
 *
 * Что делает:
 *  - номер раздела берёт из заголовка («1. ПРЕДМЕТ ДОГОВОРА» → 1);
 *  - подпункты внутри раздела нумерует подряд: 1.1, 1.2, 1.3…;
 *  - третий уровень нумерует внутри своего подпункта: 1.2.1, 1.2.2…;
 *  - перекрёстные ссылки («п. 1.3», «пункте 1.3») переписывает по карте сдвигов.
 *
 * Чего НЕ делает намеренно: не меняет номера разделов (их порядок задаёт автор),
 * не трогает таблицы и приложения — там своя нумерация строк.
 */

import { splitHtmlBlocks } from './doc-blocks'

/** Номер пункта: [раздел, подпункт, подподпункт?] */
type ClauseNumber = number[]

const HEADING_RE = /^<(h[1-4])\b/i
/** «1.», «1.1.», «1.1.1.» в начале текста — с точкой или без неё в конце */
const CLAUSE_PREFIX_RE = /^(\s*(?:<[^>]+>\s*)*)(\d+(?:\.\d+)*)\.?(\s|&nbsp;|<)/

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Номер раздела из заголовка: «2. ОБЯЗАТЕЛЬСТВА СТОРОН» → 2. Иначе null. */
function sectionNumberFromHeading(block: string): number | null {
  const text = stripTags(block)
  const m = text.match(/^(\d+)\.?\s+\S/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Номер пункта из начала блока: «1.2. Исполнитель…» → [1, 2]. Иначе null. */
function clauseNumberFromBlock(block: string): ClauseNumber | null {
  const m = block.match(CLAUSE_PREFIX_RE)
  if (!m) return null
  const parts = m[2]!.split('.').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  // Одиночное число («1.») — это заголовок раздела или пункт списка, не подпункт
  return parts.length >= 2 ? parts : null
}

/** Заменяет числовой префикс блока на новый номер, сохраняя разметку и пробелы. */
function replaceClausePrefix(block: string, next: ClauseNumber): string {
  return block.replace(CLAUSE_PREFIX_RE, (_full, lead: string, _old: string, tail: string) =>
    `${lead}${next.join('.')}.${tail}`)
}

export interface RenumberResult {
  /** Блоки с исправленной нумерацией */
  blocks: string[]
  /** Карта «старый номер → новый» только для реально изменившихся пунктов */
  renamed: Map<string, string>
}

/**
 * Пересчитывает нумерацию подпунктов по блокам документа.
 * Возвращает новые блоки и карту переименований (для перекрёстных ссылок).
 */
export function renumberClauseBlocks(blocks: string[]): RenumberResult {
  const renamed = new Map<string, string>()
  let section = 0
  let sub = 0
  let subSub = 0

  const out = blocks.map((block) => {
    if (HEADING_RE.test(block.trim())) {
      const n = sectionNumberFromHeading(block)
      if (n !== null) {
        section = n
        sub = 0
        subSub = 0
      }
      return block
    }

    const current = clauseNumberFromBlock(block)
    if (!current) return block

    // Пункты до первого заголовка (преамбула) не трогаем — не за что зацепиться
    if (section === 0) return block

    // Уровень вложенности берём из самого пункта: 1.2 → второй, 1.2.3 → третий
    let next: ClauseNumber
    if (current.length === 2) {
      sub += 1
      subSub = 0
      next = [section, sub]
    } else {
      // Третий уровень принадлежит текущему подпункту; если подпункта ещё не
      // было (документ начинается сразу с 1.1.1) — открываем его.
      if (sub === 0) sub = 1
      subSub += 1
      next = [section, sub, subSub]
    }

    const oldKey = current.join('.')
    const newKey = next.join('.')
    if (oldKey !== newKey) renamed.set(oldKey, newKey)
    return replaceClausePrefix(block, next)
  })

  return { blocks: out, renamed }
}

/**
 * Переписывает перекрёстные ссылки на пункты по карте переименований.
 * Ищет «п. 1.3», «пункт 1.3», «пункте 1.3», «пп. 1.3» — только со словом-указателем,
 * чтобы не задеть суммы, даты и номера строк таблиц.
 *
 * Замены применяются одновременно (по одному проходу), иначе цепочка
 * 1.3→1.4, 1.4→1.5 переименовала бы один и тот же пункт дважды.
 */
export function renumberCrossReferences(html: string, renamed: Map<string, string>): string {
  if (renamed.size === 0) return html
  // Падежные окончания перечислены явно: «пункту», «пунктом», «пунктах» и т.д.
  return html.replace(
    /((?:п\.?п\.?|п\.|(?:под)?пункт(?:ами|ах|ам|ов|ам|а|е|у|ом|ы|и)?)\s*)(\d+(?:\.\d+)+)/gi,
    (full, prefix: string, num: string) => {
      const next = renamed.get(num)
      return next ? `${prefix}${next}` : full
    },
  )
}

/**
 * Пересчитывает нумерацию во всём документе: подпункты и ссылки на них.
 * Вызывается после применения блочных правок ИИ — там номера и разъезжаются.
 *
 * Безопасность прежде всего: если пересчёт «съел» бы текст (сработала бы ошибка
 * разбора), возвращаем исходный HTML — лучше оставить кривой номер, чем испортить
 * договор.
 */
export function renumberDocumentHtml(html: string): string {
  if (!html.trim()) return html
  try {
    const blocks = splitHtmlBlocks(html)
    if (blocks.length === 0) return html

    const { blocks: renumbered, renamed } = renumberClauseBlocks(blocks)
    if (renamed.size === 0) return html

    const joined = renumbered.join('\n')
    // Предохранитель: объём видимого текста меняться не должен — правим только номера
    const visible = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, '').length
    if (visible(joined) < visible(html) * 0.95) return html

    return renumberCrossReferences(joined, renamed)
  } catch {
    return html
  }
}
