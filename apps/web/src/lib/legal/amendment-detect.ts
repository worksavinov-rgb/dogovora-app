// Детекция законов-поправок к отслеживаемому акту по названию (complexName).
// Чистая функция: воркер мониторинга (Часть B) отдаёт сюда документы из API.

import type { PravoDoc } from './pravo-client'

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
    if (d.number && d.number === tracked.number) continue // переиздание самого акта, не поправка
    const hay = d.complexName.toLowerCase()
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
