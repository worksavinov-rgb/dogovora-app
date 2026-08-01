// Структурирование загруженных документов: распознавание заголовков (название/разделы)
// для красивого предпросмотра и выгрузки. Комбо «эвристика + ИИ»:
//  1) promoteHeadings — мгновенно ловит очевидные заголовки (жирные/номерные/списком);
//  2) ИИ (detect_headings) — добирает пропущенные при любом оформлении, семантически.
// ВАЖНО: текст документа не переписывается — ИИ возвращает только индексы строк-заголовков,
// мы оборачиваем именно эти <p> в <h1>/<h2>. При сбое ИИ остаёмся на эвристике.
// Результат кэшируется в хранилище (один ИИ-проход на версию), оригинал в БД не меняется.

import { runWithAI } from './ai/provider'
import { promoteHeadings, collectHeadingCandidates, applyHeadingIndices, maskTables, restoreTables } from './html-document'
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
  // 1) База — только ОДНОЗНАЧНЫЕ заголовки (название, номерные разделы, списком).
  //    Неоднозначные жирные/заглавные строки НЕ помечаем — это решит ИИ семантически.
  //    Так эвристика не «переразмечает» встроенные формы, и лимит не нужен.
  const base = promoteHeadings(html, { conservative: true })

  // 2) ИИ решает, какие из оставшихся коротких строк — заголовки. Без лимита.
  //    Таблицы маскируем — их ячейки (цены/спецификации) не должны попадать
  //    ни в кандидаты, ни под обёртку заголовком.
  const { masked, tables } = maskTables(base)
  const { texts, globalIndex } = collectHeadingCandidates(masked)
  if (!texts.length) return { html: base, aiApplied: false }

  try {
    const ai = await runWithAI('detect_headings', { userId }, (p) => p.detectHeadings(texts))
    const set = new Set<number>()
    for (const li of ai.headings) {
      const g = globalIndex[li]
      if (g !== undefined) set.add(g)
    }
    const titleGlobal = ai.title != null && globalIndex[ai.title] !== undefined ? globalIndex[ai.title]! : null
    const out = restoreTables(applyHeadingIndices(masked, titleGlobal, set), tables)
    return { html: out, aiApplied: true }
  } catch (err) {
    // ИИ недоступен — запасной вариант: полная эвристика (жирные/заглавные тоже),
    // как лучшее приближение без ИИ.
    logger.error({ event: 'structure.detect_headings_failed', error: err, user_id: userId })
    return { html: promoteHeadings(html), aiApplied: false }
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
  const key = versionFileKey(versionId, 'structured-v8.html')
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
