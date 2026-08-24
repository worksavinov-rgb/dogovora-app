// Детекция законов-поправок к отслеживаемому акту по названию (complexName).
// Чистая функция: воркер мониторинга отдаёт сюда документы из API pravo.gov.ru.
//
// ВАЖНО про опознание акта: номера федеральных законов ПЕРЕИСПОЛЬЗУЮТСЯ каждый год
// («51-ФЗ» в 2026 — не ГК ч.1 от 1994, а совсем другой закон). Поэтому по номеру
// отслеживаемый акт опознать нельзя. Надёжный признак поправки — формула
// «О внесении изменений в …» в названии плюс упоминание самого акта (matchTerms).

import type { PravoDoc } from './pravo-client'

/** Формула, с которой начинается название любого закона-поправки.
 *  Обрезана до общей части: покрывает «изменений» и «изменения». */
const AMENDMENT_MARKER = 'о внесении изменен'

export interface TrackedAct {
  shortName: string
  number: string
  matchTerms: string[]
}

export interface AmendmentHit {
  eoNumber: string
  complexName: string
  documentDate: string
  matchedTerm: string
}

export function detectAmendments(tracked: TrackedAct, docs: PravoDoc[]): AmendmentHit[] {
  const terms = tracked.matchTerms.map((t) => t.toLowerCase()).filter(Boolean)
  const hits: AmendmentHit[] = []
  for (const d of docs) {
    const hay = d.complexName.toLowerCase()
    // Сам акт (или любой не-изменяющий закон) поправкой не считается.
    if (!hay.includes(AMENDMENT_MARKER)) continue
    const term = terms.find((t) => hay.includes(t))
    if (term) {
      hits.push({
        eoNumber: d.eoNumber,
        complexName: d.complexName,
        documentDate: d.documentDate,
        matchedTerm: term,
      })
    }
  }
  return hits
}
