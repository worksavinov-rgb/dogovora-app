// Мониторинг изменений законодательства: один проход по API на все отслеживаемые акты.
//
// Почему один общий проход, а не запрос на акт: API отдаёт общий поток ФЗ, и
// прогнать 13 шаблонов по одной выборке дешевле, чем сделать 13 запросов подряд.

import { DOC_TYPE_FEDERAL_LAW, type DocumentsPage, type PravoDoc, type SearchParams } from './pravo-client'
import { detectAmendments, type AmendmentHit, type TrackedAct } from './amendment-detect'

export interface TrackedActRecord extends TrackedAct {
  id: string
  lastCheckedAt: Date | null
}

export interface SyncDeps {
  search: (params: SearchParams) => Promise<DocumentsPage>
  loadTracked: () => Promise<TrackedActRecord[]>
  /** Сохраняет новые алерты. Возвращает, сколько реально добавлено (дубли по eoNumber отсекает БД). */
  saveAlerts: (trackedActId: string, hits: AmendmentHit[]) => Promise<number>
  markChecked: (trackedActId: string, at: Date) => Promise<void>
}

export interface SyncOptions {
  /** С какой даты публикации смотреть, если у акта нет lastCheckedAt. */
  defaultSince?: Date
  /** Предохранитель от вычитывания всего корпуса. */
  maxPages?: number
  /** «Сейчас» — передаётся явно, чтобы результат был воспроизводимым. */
  now?: Date
}

export interface SyncReport {
  scannedDocuments: number
  pagesFetched: number
  /** shortName → сколько новых алертов записано. */
  newAlertsByAct: Record<string, number>
  totalNewAlerts: number
}

const DEFAULT_MAX_PAGES = 20
const PAGE_SIZE = 100

/** Самая ранняя дата, с которой нужно смотреть публикации. */
function earliestSince(tracked: TrackedActRecord[], fallback: Date): Date {
  const dates = tracked.map((t) => t.lastCheckedAt).filter((d): d is Date => d instanceof Date)
  if (dates.length !== tracked.length || dates.length === 0) return fallback
  return dates.reduce((min, d) => (d < min ? d : min), dates[0])
}

export async function syncTrackedActs(deps: SyncDeps, opts: SyncOptions = {}): Promise<SyncReport> {
  const now = opts.now ?? new Date()
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const fallbackSince = opts.defaultSince ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000)

  const tracked = (await deps.loadTracked()).filter((t) => t.matchPatterns.length > 0)
  const report: SyncReport = { scannedDocuments: 0, pagesFetched: 0, newAlertsByAct: {}, totalNewAlerts: 0 }
  if (tracked.length === 0) return report

  const since = earliestSince(tracked, fallbackSince)

  // ── один проход по страницам ФЗ ──────────────────────────────────────────
  const docs: PravoDoc[] = []
  let index = 1
  let totalPages = 1
  while (index <= Math.min(totalPages, maxPages)) {
    const page = await deps.search({
      documentTypes: [DOC_TYPE_FEDERAL_LAW],
      publishDateFrom: since,
      pageSize: PAGE_SIZE,
      index,
    })
    docs.push(...page.items)
    report.pagesFetched += 1
    totalPages = Math.max(1, page.pagesTotalCount)
    if (page.items.length === 0) break
    index += 1
  }
  report.scannedDocuments = docs.length

  // ── прогоняем шаблоны каждого акта по общей выборке ───────────────────────
  for (const act of tracked) {
    const hits = detectAmendments(act, docs)
    const added = hits.length > 0 ? await deps.saveAlerts(act.id, hits) : 0
    report.newAlertsByAct[act.shortName] = added
    report.totalNewAlerts += added
    await deps.markChecked(act.id, now)
  }

  return report
}
