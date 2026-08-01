// Структурирование загруженных документов: распознавание заголовков (название/разделы)
// для красивого предпросмотра и выгрузки. Комбо «эвристика + ИИ»:
//  1) promoteHeadings — мгновенно ловит очевидные заголовки (жирные/номерные/списком);
//  2) ИИ (detect_headings) — добирает пропущенные при любом оформлении, семантически.
// ВАЖНО: текст документа не переписывается — ИИ возвращает только индексы строк-заголовков,
// мы оборачиваем именно эти <p> в <h1>/<h2>. При сбое ИИ остаёмся на эвристике.
// Результат кэшируется в хранилище (один ИИ-проход на версию), оригинал в БД не меняется.

import { runWithAI } from './ai/provider'
import { promoteHeadings, collectHeadingCandidates, applyHeadingIndices } from './html-document'
import { readFile, saveFile, fileExists, versionFileKey } from './storage'
import { logger } from './logger'

// Системно-сгенерированные документы уже со структурой (классы преамбулы/реквизитов).
const SYSTEM_CLASS_RE = /class="[^"]*doc-(?:preamble|requisites)/i

/** Похоже ли на загруженный HTML-документ (а не сгенерированный системой и не markdown). */
export function looksLikeUpload(html: string): boolean {
  return !!html && /<[a-z]/i.test(html) && !SYSTEM_CLASS_RE.test(html)
}

/**
 * Структурирует HTML загруженного документа: эвристика + ИИ.
 * Возвращает готовый HTML и флаг, применялся ли ИИ (для решения о кэшировании).
 */
export async function structureUploadedHtml(html: string, userId: string): Promise<{ html: string; aiApplied: boolean }> {
  // 1) Эвристика
  let out = promoteHeadings(html)

  // 2) ИИ добирает пропущенные заголовки среди оставшихся коротких <p>
  const { texts, globalIndex } = collectHeadingCandidates(out)
  if (!texts.length) return { html: out, aiApplied: false }

  try {
    const ai = await runWithAI('detect_headings', { userId }, (p) => p.detectHeadings(texts))
    // Защита от переразметки: у договора разделов немного. Если ИИ пометил слишком
    // много строк как заголовки (частая ошибка на документах со встроенными формами/
    // заявками и блоками подписей) — не доверяем ИИ и остаёмся на эвристике.
    const MAX_AI_HEADINGS = 22
    if (ai.headings.length > MAX_AI_HEADINGS) {
      logger.error({ event: 'structure.detect_headings_too_many', count: ai.headings.length, user_id: userId })
      return { html: out, aiApplied: true } // кэшируем эвристику — стабильно и без «частокола» заголовков
    }
    const set = new Set<number>()
    for (const li of ai.headings) {
      const g = globalIndex[li]
      if (g !== undefined) set.add(g)
    }
    const titleGlobal = ai.title != null && globalIndex[ai.title] !== undefined ? globalIndex[ai.title]! : null
    out = applyHeadingIndices(out, titleGlobal, set)
    return { html: out, aiApplied: true }
  } catch (err) {
    logger.error({ event: 'structure.detect_headings_failed', error: err, user_id: userId })
    return { html: out, aiApplied: false } // мягкий откат на эвристику
  }
}

/**
 * Возвращает структурированный контент версии с кэшем в хранилище.
 * ИИ-проход выполняется не более одного раза на версию (append-only: оригинал в БД цел).
 * Для сгенерированных/не-HTML документов возвращает контент как есть.
 */
export async function getStructuredContentCached(versionId: string, content: string | null, userId: string): Promise<string> {
  const html = content ?? ''
  if (!looksLikeUpload(html)) return html

  // Версия в имени кэша: при изменении алгоритма распознавания бампаем суффикс,
  // чтобы прод пересчитал (старый кэш игнорируется).
  const key = versionFileKey(versionId, 'structured-v2.html')
  try {
    if (await fileExists(key)) return (await readFile(key)).toString('utf8')
  } catch { /* нет кэша — считаем ниже */ }

  const { html: structured, aiApplied } = await structureUploadedHtml(html, userId)
  // Кэшируем только успешный ИИ-проход, чтобы после временного сбоя ИИ можно было повторить.
  if (aiApplied) {
    try { await saveFile(key, Buffer.from(structured, 'utf8')) } catch { /* кэш необязателен */ }
  }
  return structured
}
