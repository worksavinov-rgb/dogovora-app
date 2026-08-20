/**
 * edit-report.ts — что именно изменилось в документе после правки ИИ.
 *
 * Зачем: в режиме «Правка» пользователь получал одну и ту же строку «Готово —
 * изменения внесены в документ», даже когда ИИ выполнил задание частично или
 * не так, как просили. Понять, что произошло, было невозможно — приходилось
 * вычитывать договор глазами.
 *
 * Здесь считается фактический список изменений (по блокам документа), а на его
 * основе собирается задание модели: рассказать, что сделано, зачем и что из
 * просьбы осталось невыполненным. Сам список — детерминированный, его считает
 * код, поэтому «придумать» несуществующую правку модель не может.
 */
import { splitHtmlBlocks } from './doc-blocks'

export type ChangeKind = 'added' | 'removed' | 'changed'

export interface BlockChange {
  kind: ChangeKind
  /** Текст блока до правки (для removed / changed) */
  before?: string
  /** Текст блока после правки (для added / changed) */
  after?: string
}

/** Видимый текст блока без разметки — по нему сравниваем. */
function blockText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Обрезает длинный фрагмент — в задание модели не нужен весь пункт целиком. */
function clip(text: string, limit = 400): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * Сравнивает документ до и после правки и возвращает список изменений блоков.
 * Используется LCS по тексту блоков: неизменённые блоки образуют общую
 * подпоследовательность, всё остальное — вставки, удаления и замены.
 */
export function diffDocumentBlocks(before: string, after: string): BlockChange[] {
  const a = splitHtmlBlocks(before).map(blockText).filter(Boolean)
  const b = splitHtmlBlocks(after).map(blockText).filter(Boolean)

  // Таблица длин наибольшей общей подпоследовательности
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const changes: BlockChange[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      // Блок из «до» исчез: удаление либо первая половина замены
      const removed = a[i]!
      const nextIsInsert = j < b.length && lcs[i + 1]![j]! === lcs[i + 1]![j + 1]!
      if (nextIsInsert) {
        changes.push({ kind: 'changed', before: clip(removed), after: clip(b[j]!) })
        i++; j++
      } else {
        changes.push({ kind: 'removed', before: clip(removed) })
        i++
      }
    } else {
      changes.push({ kind: 'added', after: clip(b[j]!) })
      j++
    }
  }
  while (i < a.length) { changes.push({ kind: 'removed', before: clip(a[i]!) }); i++ }
  while (j < b.length) { changes.push({ kind: 'added', after: clip(b[j]!) }); j++ }

  return changes
}

/** Короткая сводка для интерфейса: «изменено 3, добавлено 2». */
export function summarizeChanges(changes: BlockChange[]): string {
  const changed = changes.filter((c) => c.kind === 'changed').length
  const added = changes.filter((c) => c.kind === 'added').length
  const removed = changes.filter((c) => c.kind === 'removed').length
  const parts: string[] = []
  if (changed) parts.push(`изменено пунктов: ${changed}`)
  if (added) parts.push(`добавлено: ${added}`)
  if (removed) parts.push(`удалено: ${removed}`)
  return parts.join(', ')
}

/** Максимум изменений, которые отдаём модели — иначе задание раздувается. */
const MAX_CHANGES_IN_PROMPT = 12

/**
 * Задание модели: объяснить внесённые правки. Список изменений посчитан кодом,
 * модель только формулирует смысл — и обязана назвать невыполненное.
 */
export function buildEditReportPrompt(instruction: string, changes: BlockChange[]): string {
  const shown = changes.slice(0, MAX_CHANGES_IN_PROMPT)
  const lines = shown.map((c, idx) => {
    if (c.kind === 'added') return `${idx + 1}. ДОБАВЛЕНО: ${c.after}`
    if (c.kind === 'removed') return `${idx + 1}. УДАЛЕНО: ${c.before}`
    return `${idx + 1}. ИЗМЕНЕНО\n   было: ${c.before}\n   стало: ${c.after}`
  })
  const tail = changes.length > shown.length
    ? `\n(и ещё изменений: ${changes.length - shown.length})`
    : ''

  return [
    'Ты юрист, который только что внёс правки в договор клиента и отчитывается о проделанной работе.',
    '',
    `ЗАДАНИЕ КЛИЕНТА: ${instruction}`,
    '',
    'ФАКТИЧЕСКИ ВНЕСЁННЫЕ ИЗМЕНЕНИЯ (посчитаны автоматически, это правда):',
    lines.join('\n') + tail,
    '',
    'Напиши клиенту короткий отчёт (до 150 слов), обычным текстом, без markdown:',
    '1. Что именно изменено — по пунктам, с их номерами.',
    '2. Зачем: как это влияет на права, обязанности и риски клиента с юридической точки зрения.',
    '3. Если часть задания НЕ выполнена (например, клиент просил добавить пункты, а их в списке изменений нет) — прямо скажи, что не сделано, и предложи повторить запрос точнее.',
    '',
    'Не выдумывай изменений, которых нет в списке. Не пересказывай текст договора целиком.',
  ].join('\n')
}
