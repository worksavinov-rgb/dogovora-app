'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface BreakdownItem {
  type: string
  label: string
  bytes: number
}

interface StorageData {
  usedBytes: number
  totalDocs: number
  totalVersions: number
  breakdown: BreakdownItem[]
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 КБ'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

// ─── Цвета для breakdown ──────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  CONTRACT:  'oklch(0.42 0.06 260)',   // accent (indigo)
  APPENDIX:  'oklch(0.6  0.1  60)',    // amber
  AMENDMENT: 'oklch(0.55 0.08 200)',   // teal
}

// ─── SVG Donut-чарт: доли ТИПОВ в занятом месте (лимитов нет) ────────────────

function DonutChart({ breakdown, usedBytes }: { breakdown: BreakdownItem[]; usedBytes: number }) {
  const r = 56
  const circ = 2 * Math.PI * r
  const size = 160

  // Сегменты — доли типов от общего занятого места
  const segments: { offset: number; length: number; color: string }[] = []
  let accumulated = 0
  for (const item of breakdown) {
    if (item.bytes === 0 || usedBytes === 0) continue
    const length = (item.bytes / usedBytes) * circ
    segments.push({
      offset: -accumulated,
      length,
      color: TYPE_COLORS[item.type] ?? 'var(--ink-4)',
    })
    accumulated += length
  }

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="10"
            strokeDasharray={`${seg.length} ${circ - seg.length}`}
            strokeDashoffset={seg.offset}
            strokeLinecap="butt"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[20px] font-medium leading-none"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}
        >
          {formatBytes(usedBytes)}
        </span>
        <span className="text-[10px] text-[var(--ink-4)] mt-[2px]">занято</span>
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function StoragePage() {
  const [data, setData] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    fetch('/api/storage')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[120px]">
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="max-w-[860px] py-[80px] text-center">
        <p className="text-[15px] text-[var(--ink-2)] mb-[6px]" style={{ fontFamily: 'var(--font-serif)' }}>
          Не удалось загрузить данные хранилища
        </p>
        <p className="text-[13px] text-[var(--ink-4)]">Обновите страницу или попробуйте позже.</p>
      </div>
    )
  }

  return (
    <div className="max-w-[860px]">
      <div className="mb-[24px]">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>
          Хранилище
        </h2>
        <p className="text-[13px] text-[var(--ink-4)] mt-[4px]">
          Все версии ваших документов хранятся без ограничений.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-[20px]">
        {/* Левая — чарт + breakdown */}
        <Card>
          <div className="flex flex-col sm:flex-row items-center gap-[24px] sm:gap-[32px]">
            <DonutChart breakdown={data.breakdown} usedBytes={data.usedBytes} />

            <div className="flex-1 w-full">
              <div className="mb-[16px]">
                <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[4px]">
                  Использовано
                </p>
                <p className="text-[22px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatBytes(data.usedBytes)}
                </p>
              </div>

              {/* Breakdown по типам */}
              <div className="flex flex-col gap-[8px]">
                {data.breakdown.map((item) => (
                  <div key={item.type} className="flex items-center gap-[8px]">
                    <div
                      className="shrink-0 w-[8px] h-[8px] rounded-full"
                      style={{ background: TYPE_COLORS[item.type] ?? 'var(--ink-4)' }}
                    />
                    <p className="flex-1 text-[12px] text-[var(--ink-3)]">{item.label}</p>
                    <p
                      className="text-[12px] font-medium text-[var(--ink-2)]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatBytes(item.bytes)}
                    </p>
                  </div>
                ))}
                {data.breakdown.every((b) => b.bytes === 0) && (
                  <p className="text-[12px] text-[var(--ink-4)]">Файлов пока нет</p>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Правая — сводка */}
        <div className="flex flex-col gap-[12px]">
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">
              В хранилище
            </p>
            <div className="flex flex-col gap-[8px]">
              {[
                { label: 'Документов', value: data.totalDocs },
                { label: 'Версий', value: data.totalVersions },
              ].map((row) => (
                <div key={row.label} className="flex justify-between items-center text-[13px]">
                  <p className="text-[var(--ink-4)]">{row.label}</p>
                  <p className="font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>{row.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">
              Как это работает
            </p>
            <div className="flex flex-col gap-[6px] text-[12px] text-[var(--ink-3)] leading-[1.6]">
              <p>Каждое изменение документа — новая версия, старые не перезаписываются.</p>
              <p>Купленные версии доступны для скачивания в любой момент.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
