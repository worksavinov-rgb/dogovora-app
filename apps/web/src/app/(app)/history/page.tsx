'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface VersionEntry {
  id: string
  number: number
  status: string
  createdAt: string
  description: string | null
  document: {
    id: string
    title: string
    type: 'CONTRACT' | 'APPENDIX' | 'AMENDMENT'
    counterparty: { id: string; name: string }
  }
  purchase: { amount: number } | null
}

interface Stats {
  totalVersions: number
  paidVersions: number
  paidAmount: number
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  CONTRACT: 'Дог', APPENDIX: 'Прил', AMENDMENT: 'ДС',
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT:       { label: 'Черновик',     color: 'var(--ink-4)',          bg: 'var(--surface-inset)' },
  IN_PROGRESS: { label: 'В работе',     color: 'oklch(0.45 0.1 260)',   bg: 'oklch(0.95 0.015 260)' },
  REVIEW:      { label: 'На проверке',  color: 'oklch(0.55 0.1 60)',    bg: 'oklch(0.97 0.015 60)' },
  APPROVED:    { label: 'Утверждено',   color: 'oklch(0.45 0.1 145)',   bg: 'oklch(0.95 0.02 145)' },
  PAID:        { label: 'Оплачено',     color: 'oklch(0.35 0.08 145)',  bg: 'oklch(0.93 0.03 145)' },
}

function formatMoney(n: number) {
  return n.toLocaleString('ru', { maximumFractionDigits: 0 })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

function formatDayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  const dateStr = d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
  if (diff === 0) return `Сегодня, ${dateStr}`
  if (diff === 1) return `Вчера, ${dateStr}`
  return dateStr
}

function getDayKey(iso: string) {
  return new Date(iso).toLocaleDateString('ru')
}

function groupByDay(versions: VersionEntry[]): [string, VersionEntry[]][] {
  const map = new Map<string, VersionEntry[]>()
  for (const v of versions) {
    const key = getDayKey(v.createdAt)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(v)
  }
  return Array.from(map.entries())
}

// grid: время | тип | название | версия | контрагент | статус | сумма
const GRID = 'grid grid-cols-[56px_44px_1fr_52px_220px_120px_80px]'

// ─── Шапка таблицы ────────────────────────────────────────────────────────────

function TableHeader() {
  return (
    <div className={`${GRID} gap-[8px] px-[16px] py-[9px] border-b border-[var(--line)] bg-[var(--surface-inset)] rounded-t-[var(--radius-lg)]`}>
      {[
        'Время', 'Тип', 'Название', 'Версия', 'Контрагент', 'Статус', 'Сумма',
      ].map((col) => (
        <p key={col} className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em] truncate">
          {col}
        </p>
      ))}
    </div>
  )
}

// ─── Строка версии ────────────────────────────────────────────────────────────

function VersionRow({ v, isLast }: { v: VersionEntry; isLast: boolean }) {
  const router = useRouter()
  const status = STATUS_MAP[v.status] ?? STATUS_MAP.DRAFT!

  return (
    <div
      className={[
        GRID,
        'gap-[8px] px-[16px] py-[11px] items-center cursor-pointer hover:bg-[var(--surface-2)] transition-colors',
        !isLast ? 'border-b border-[var(--line)]' : '',
      ].join(' ')}
      onClick={() => router.push(`/documents/${v.document.id}/work?version=${v.id}`)}
    >
      {/* Время */}
      <span className="text-[11px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>
        {formatTime(v.createdAt)}
      </span>

      {/* Тип */}
      <div
        className="w-[32px] h-[22px] rounded-[var(--radius-sm)] flex items-center justify-center text-[9px] font-bold"
        style={{ background: 'var(--surface-inset)', color: 'var(--ink-4)' }}
      >
        {TYPE_LABELS[v.document.type]}
      </div>

      {/* Название */}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[var(--ink)] truncate">{v.document.title}</p>
        {v.description && (
          <p className="text-[11px] text-[var(--ink-4)] truncate mt-[1px]">{v.description}</p>
        )}
      </div>

      {/* Версия */}
      <span className="text-[12px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>
        v.{v.number}
      </span>

      {/* Контрагент */}
      <p className="text-[12px] text-[var(--ink-3)] truncate">{v.document.counterparty.name}</p>

      {/* Статус */}
      <span
        className="inline-flex items-center px-[8px] h-[22px] rounded-full text-[11px] font-medium w-fit"
        style={{ background: status.bg, color: status.color }}
      >
        {status.label}
      </span>

      {/* Сумма */}
      {v.purchase ? (
        <span className="text-[12px] font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'oklch(0.45 0.1 145)' }}>
          {formatMoney(v.purchase.amount)} ₽
        </span>
      ) : (
        <span className="text-[12px] text-[var(--ink-5)]">—</span>
      )}
    </div>
  )
}

// ─── Константы фильтров ───────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { key: '', label: 'Все типы' },
  { key: 'CONTRACT', label: 'Договоры' },
  { key: 'APPENDIX', label: 'Приложения' },
  { key: 'AMENDMENT', label: 'Доп. соглашения' },
]

const DATE_FILTERS: { key: 'week' | 'month' | 'all'; label: string; days: number | null }[] = [
  { key: 'week',  label: 'Последние 7 дней',  days: 7 },
  { key: 'month', label: 'Последние 30 дней', days: 30 },
  { key: 'all',   label: 'Всё время',         days: null },
]

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState<'week' | 'month' | 'all'>('all')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (typeFilter) params.set('type', typeFilter)

    fetch(`/api/history?${params}`)
      .then((r) => r.ok ? r.json() : { versions: [], stats: null })
      .then((data) => {
        setVersions(data.versions ?? [])
        setStats(data.stats ?? null)
      })
      .finally(() => setLoading(false))
  }, [typeFilter])

  // Клиентская фильтрация по дате
  const filteredVersions = (() => {
    const df = DATE_FILTERS.find((f) => f.key === dateFilter)
    if (!df || df.days === null) return versions
    const cutoff = Date.now() - df.days * 86400000
    return versions.filter((v) => new Date(v.createdAt).getTime() >= cutoff)
  })()

  const grouped = groupByDay(filteredVersions)

  return (
    <div className="max-w-[1280px]">
      {/* Заголовок */}
      <div className="mb-[24px]">
        {stats && (
          <p className="text-[12px] text-[var(--ink-4)] mb-[4px]">
            {stats.totalVersions} {stats.totalVersions === 1 ? 'версия' : 'версий'}
            {stats.paidAmount > 0 && <> · <span style={{ color: 'oklch(0.45 0.1 145)' }}>{formatMoney(stats.paidAmount)} ₽ оплачено</span></>}
          </p>
        )}
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>
          История версий
        </h2>
        <p className="text-[13px] text-[var(--ink-3)] mt-[4px]">
          Все версии ваших документов. Купленные версии можно скачать повторно бесплатно.
        </p>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-[8px] mb-[20px]">
        {/* Тип документа */}
        <div className="flex gap-[4px]">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className="px-[12px] h-[30px] rounded-full text-[12px] font-medium transition-colors cursor-pointer"
              style={{
                background: typeFilter === f.key ? 'var(--ink)' : 'var(--surface-inset)',
                color: typeFilter === f.key ? 'var(--bg)' : 'var(--ink-3)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="w-px h-[20px] bg-[var(--line)] mx-[4px]" />

        {/* Период */}
        <div className="flex gap-[4px]">
          {DATE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setDateFilter(f.key)}
              className="px-[12px] h-[30px] rounded-full text-[12px] font-medium transition-colors cursor-pointer"
              style={{
                background: dateFilter === f.key ? 'var(--ink)' : 'var(--surface-inset)',
                color: dateFilter === f.key ? 'var(--bg)' : 'var(--ink-3)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Контент */}
      {loading ? (
        <div className="rounded-[var(--radius-lg)] overflow-hidden" style={{ background: 'white', border: '1px solid var(--line)' }}>
          <TableHeader />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`${GRID} gap-[8px] px-[16px] py-[11px] items-center border-b border-[var(--line)] last:border-0`}>
              <Skeleton className="h-[10px] w-[36px]" />
              <Skeleton className="h-[22px] w-[32px] rounded-[var(--radius-sm)]" />
              <div className="flex flex-col gap-[5px]"><Skeleton className="h-[13px] w-[55%]" /><Skeleton className="h-[10px] w-[30%]" /></div>
              <Skeleton className="h-[10px] w-[32px]" />
              <Skeleton className="h-[12px] w-[70%]" />
              <Skeleton className="h-[22px] w-[80px] rounded-full" />
              <Skeleton className="h-[12px] w-[40px]" />
            </div>
          ))}
        </div>
      ) : filteredVersions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-[80px] gap-[12px]">
          <div className="w-[48px] h-[48px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <p className="text-[15px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
            {dateFilter !== 'all' ? 'За этот период версий нет' : 'Версий пока нет'}
          </p>
          <p className="text-[12px] text-[var(--ink-4)]">
            {dateFilter !== 'all' ? 'Попробуйте расширить период' : 'Создайте первый документ чтобы начать'}
          </p>
        </div>
      ) : (
        <div
          className="rounded-[var(--radius-lg)] overflow-hidden"
          style={{ background: 'white', border: '1px solid var(--line)' }}
        >
          <TableHeader />
          {grouped.map(([dayKey, dayVersions], gi) => (
            <div key={dayKey}>
              {/* Разделитель дня */}
              <div
                className={['flex items-center gap-[12px] px-[16px] py-[8px]', gi > 0 ? 'border-t border-[var(--line)]' : ''].join(' ')}
                style={{ background: 'var(--surface-inset)' }}
              >
                <p className="text-[11px] font-medium text-[var(--ink-3)]">
                  {formatDayLabel(dayVersions[0].createdAt)}
                </p>
              </div>
              {dayVersions.map((v, i) => (
                <VersionRow key={v.id} v={v} isLast={gi === grouped.length - 1 && i === dayVersions.length - 1} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
