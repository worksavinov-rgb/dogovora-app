// Детекция законов-поправок к отслеживаемому акту по названию (complexName).
// Чистая функция: воркер мониторинга отдаёт сюда документы из API pravo.gov.ru.
//
// Два неочевидных факта, проверенных на реальной выдаче API:
//
// 1) Номера ФЗ ПЕРЕИСПОЛЬЗУЮТСЯ каждый год: «14-ФЗ» — это и ГК ч.2 (1996), и закон
//    об ООО (1998), и совсем другой закон 2026 года. Опознать акт по номеру нельзя.
//    Надёжный признак поправки — формула «О внесении изменений в …» в названии.
//
// 2) Названия кодексов в этой формуле СКЛОНЯЮТСЯ: «в часть первую Гражданского
//    кодекса», «в статью 41 части первой Налогового кодекса». Подстрочный поиск по
//    именительному падежу («гражданский кодекс») пропускает большинство поправок,
//    поэтому matchPatterns — регулярные выражения с допуском на окончания.
//    ВНИМАНИЕ: в JS \\w НЕ включает кириллицу — окончания задаём классом [а-яё].

import type { PravoDoc } from './pravo-client'

/** Формула, с которой начинается название любого закона-поправки.
 *  Обрезана до общей части: покрывает «изменений» и «изменения». */
const AMENDMENT_MARKER = 'о внесении изменен'

export interface TrackedAct {
  shortName: string
  number: string
  /** Регулярные выражения (источник, без флагов) — сопоставляются регистронезависимо. */
  matchPatterns: string[]
}

export interface AmendmentHit {
  eoNumber: string
  complexName: string
  documentDate: string
  /** Какой шаблон сработал — для отладки и показа админу. */
  matchedPattern: string
}

function compile(patterns: string[]): Array<{ src: string; re: RegExp }> {
  const out: Array<{ src: string; re: RegExp }> = []
  for (const src of patterns) {
    if (!src) continue
    try {
      out.push({ src, re: new RegExp(src, 'i') })
    } catch {
      // битый шаблон в реестре не должен ронять весь мониторинг
    }
  }
  return out
}

export function detectAmendments(tracked: TrackedAct, docs: PravoDoc[]): AmendmentHit[] {
  const patterns = compile(tracked.matchPatterns)
  const hits: AmendmentHit[] = []
  for (const d of docs) {
    const hay = d.complexName.toLowerCase()
    // Сам акт (или любой не-изменяющий закон) поправкой не считается.
    if (!hay.includes(AMENDMENT_MARKER)) continue
    const hit = patterns.find((p) => p.re.test(d.complexName))
    if (hit) {
      hits.push({
        eoNumber: d.eoNumber,
        complexName: d.complexName,
        documentDate: d.documentDate,
        matchedPattern: hit.src,
      })
    }
  }
  return hits
}
