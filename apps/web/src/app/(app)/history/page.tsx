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
  CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'ДС',
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
  const dateStr = d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
  if (diff === 0) return `СЕГОДНЯ · ${dateStr}`
  if (diff === 1) return `ВЧЕРА · ${dateStr}`
  return dateStr
}

function getDayKey(iso: string) {
  return new Date(iso).toLocaleDateString('ru')
}

// Группировка по дням
function groupByDay(versions: VersionEntry[]): [string, VersionEntry[]][] {
  const map = new Map<string, VersionEntry[]>()
  for (const v of versions) {
    const key = getDayKey(v.createdAt)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(v)
  }
  return Array.from(map.entries())
}

// ─── Строка версии (таймлайн) ─────────────────────────────────────────────────

function VersionRow({ v }: { v: VersionEntry }) {
  const router = useRouter()
  const status = STATUS_MAP[v.status] ?? STATUS_MAP.DRAFT

  return (
    <div
      className="flex items-start gap-[16px] cursor-pointer group"
      onClick={() => router.push(`/documents/${v.document.id}/work?version=${v.id}`)}
    >
      {/* Время + точка таймлайна */}
      <div className="shrink-0 flex flex-col items-center gap-[6px] w-[40px]">
        <p className="text-[11px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {formatTime(v.createdAt)}
        </p>
        <div
          className="w-[8px] h-[8px] rounded-full border-2 border-[var(--bg)]"
          style={{ background: v.purchase ? 'oklch(0.45 0.1 145)' : 'var(--line)', boxShadow: '0 0 0 1px var(--line)' }}
        />
      </div>

      {/* Карточка версии */}
      <div
        className="flex-1 flex items-center gap-[12px] rounded-[var(--radius-md)] px-[16px] py-[12px] mb-[8px] transition-colors group-hover:bg-[var(--surface-inset)]"
        style={{ border: '1px solid var(--line)', background: 'var(--bg)' }}
      >
        {/* Тип документа */}
        <div
          className="shrink-0 w-[28px] h-[28px] rounded-[var(--radius-sm)] flex items-center justify-center text-[9px] font-bold"
          style={{ background: 'var(--surface-inset)', color: 'var(--ink-4)' }}
        >
          {TYPE_LABELS[v.document.type]}
        </div>

        {/* Основное */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[var(--ink)] truncate">
            {v.document.title}
          </p>
          <div className="flex items-center gap-[6px] mt-[2px]">
            <span className="text-[11px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>
              v.{v.number}
            </span>
            {v.description && (
              <>
                <span className="text-[var(--line)]">·</span>
                <span className="text-[11px] text-[var(--ink-4)] truncate">{v.description}</span>
              </>
            )}
          </div>
        </div>

        {/* Контрагент */}
        <p className="shrink-0 text-[11px] text-[var(--ink-4)] hidden sm:block max-w-[120px] truncate">
          {v.document.counterparty.name}
        </p>

        {/* Статус */}
        <span
          className="shrink-0 inline-flex items-center px-[8px] h-[20px] rounded-full text-[10px] font-medium"
          style={{ background: status.bg, color: status.color }}
        >
          {status.label}
        </span>

        {/* Цена если куплено */}
        {v.purchase ? (
          <span className="shrink-0 text-[12px] font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'oklch(0.45 0.1 145)' }}>
            {formatMoney(v.purchase.amount)} ₽
          </span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--line)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { key: '', label: 'Все' },
  { key: 'CONTRACT', label: 'Договоры' },
  { key: 'APPENDIX', label: 'Приложения' },
  { key: 'AMENDMENT', label: 'ДС' },
]

export default function HistoryPage() {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [viewMode, setViewMode] = useState<'timeline' | 'docs'>('timeline')

  useEffect(() => {
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

  const grouped = groupByDay(versions)

  return (
    <div className="max-w-[860px]">
      {/* Заголовок */}
      <div className="mb-[20px]">
        {stats && (
          <p className="text-[12px] text-[var(--ink-4)] mb-[4px] uppercase tracking-[0.06em]">
            {stats.totalVersions} версий · {stats.paidAmount > 0 ? `${formatMoney(stats.paidAmount)} ₽ оплачено` : ''}
          </p>
        )}
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>
          История версий
        </h2>
        <p className="text-[13px] text-[var(--ink-3)] mt-[4px]">
          Все версии всех документов в хронологическом порядке. Купленные версии скачиваются повторно бесплатно.
        </p>
      </div>

      {/* Фильтры + переключатель вида */}
      <div className="flex items-center justify-between mb-[20px]">
        <div className="flex gap-[4px]">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setTypeFilter(f.key); setLoading(true) }}
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

        <div className="flex rounded-[var(--radius-md)] overflow-hidden" style={{ border: '1px solid var(--line)' }}>
          {([
            { key: 'timeline', label: 'Хронология' },
            { key: 'docs',     label: 'По документам' },
          ] as const).map((tab) => (
            <button key={tab.key} onClick={() => setViewMode(tab.key)}
              className="px-[10px] h-[28px] text-[11px] font-medium transition-colors cursor-pointer"
              style={{
                background: viewMode === tab.key ? 'var(--ink)' : 'var(--bg)',
                color: viewMode === tab.key ? 'var(--bg)' : 'var(--ink-3)',
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Контент */}
      {loading ? (
        <div className="flex flex-col gap-[24px]">
          {Array.from({ length: 2 }).map((_, g) => (
            <div key={g}>
              <div className="flex items-center gap-[12px] mb-[12px]">
                <Skeleton className="h-[10px] w-[120px]" />
                <div className="flex-1 h-px bg-[var(--line)]" />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-[16px] mb-[8px]">
                  <div className="shrink-0 w-[40px] flex flex-col items-center gap-[6px]">
                    <Skeleton className="h-[10px] w-[32px]" />
                    <div className="w-[8px] h-[8px] rounded-full bg-[var(--line)]" />
                  </div>
                  <div className="flex-1 rounded-[var(--radius-md)] px-[16px] py-[12px]" style={{ border: '1px solid var(--line)' }}>
                    <div className="flex items-center gap-[12px]">
                      <Skeleton className="w-[28px] h-[28px] shrink-0" />
                      <div className="flex-1 flex flex-col gap-[6px]">
                        <Skeleton className="h-[13px] w-[50%]" />
                        <Skeleton className="h-[10px] w-[20%]" />
                      </div>
                      <Skeleton className="h-[20px] w-[72px] rounded-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : versions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-[80px] gap-[12px]">
          <div className="w-[48px] h-[48px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <p className="text-[15px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
            Версий пока нет
          </p>
          <p className="text-[12px] text-[var(--ink-4)]">Создайте первый документ чтобы начать</p>
        </div>
      ) : (
        <div>
          {grouped.map(([dayKey, dayVersions]) => (
            <div key={dayKey} className="mb-[24px]">
              {/* Eyebrow-заголовок дня */}
              <div className="flex items-center gap-[12px] mb-[12px]">
                <p className="text-[10px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] whitespace-nowrap">
                  {formatDayLabel(dayVersions[0].createdAt)}
                </p>
                <div className="flex-1 h-px bg-[var(--line)]" />
              </div>

              {/* Строки версий */}
              <div className="pl-[0px]">
                {/* Вертикальная линия таймлайна */}
                <div className="relative">
                  <div
                    className="absolute left-[44px] top-[20px] bottom-[20px] w-px"
                    style={{ background: 'var(--line)' }}
                  />
                  {dayVersions.map((v) => (
                    <VersionRow key={v.id} v={v} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
