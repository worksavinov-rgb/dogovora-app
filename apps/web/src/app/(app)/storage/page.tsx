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
  plan: 'STARTER' | 'BUSINESS' | 'BUREAU'
  usedBytes: number
  limitBytes: number
  percent: number
  breakdown: BreakdownItem[]
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 КБ'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function formatLimit(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb % 1 === 0 ? gb : gb.toFixed(1)} ГБ`
  return `${Math.round(bytes / (1024 * 1024))} МБ`
}

// ─── Цвета для breakdown ──────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  CONTRACT:  'oklch(0.42 0.06 260)',   // accent (indigo)
  APPENDIX:  'oklch(0.6  0.1  60)',    // amber
  AMENDMENT: 'oklch(0.55 0.08 200)',   // teal
}

const TYPE_BG: Record<string, string> = {
  CONTRACT:  'oklch(0.95 0.015 260)',
  APPENDIX:  'oklch(0.97 0.015 60)',
  AMENDMENT: 'oklch(0.96 0.015 200)',
}

// ─── SVG Donut-чарт ───────────────────────────────────────────────────────────

function DonutChart({
  percent, breakdown, limitBytes,
}: {
  percent: number
  breakdown: BreakdownItem[]
  limitBytes: number
}) {
  const r = 56
  const circ = 2 * Math.PI * r
  const size = 160

  // Строим сегменты по breakdown
  const total = breakdown.reduce((s, b) => s + b.bytes, 0)
  const segments: { offset: number; length: number; color: string; type: string }[] = []
  let accumulated = 0

  for (const item of breakdown) {
    if (item.bytes === 0) continue
    const fraction = total > 0 ? item.bytes / limitBytes : 0
    const length = fraction * circ
    segments.push({
      offset: circ - accumulated,
      length,
      color: TYPE_COLORS[item.type] ?? 'var(--ink-4)',
      type: item.type,
    })
    accumulated += length
  }

  const isWarning = percent > 68

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Трек */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--line)" strokeWidth="10"
        />
        {/* Заполненная дуга (если нет breakdown или всё пустое) */}
        {segments.length === 0 && percent > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={isWarning ? 'var(--danger)' : 'var(--accent)'}
            strokeWidth="10"
            strokeDasharray={`${(percent / 100) * circ} ${circ}`}
            strokeDashoffset={circ / 4}
            strokeLinecap="round"
          />
        )}
        {/* Сегменты по типам */}
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

      {/* Центр */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[28px] font-medium leading-none"
          style={{
            fontFamily: 'var(--font-mono)',
            color: isWarning ? 'var(--danger)' : 'var(--ink)',
          }}
        >
          {percent}%
        </span>
        <span className="text-[10px] text-[var(--ink-4)] mt-[2px]">занято</span>
      </div>
    </div>
  )
}

// ─── Тарифные карточки ────────────────────────────────────────────────────────

const PLANS = [
  {
    key: 'STARTER',
    name: 'Старт',
    storage: '500 МБ',
    price: 'Бесплатно',
    features: ['До 50 документов', 'ИИ-чат', 'Проверка рисков'],
  },
  {
    key: 'BUSINESS',
    name: 'Дело',
    storage: '5 ГБ',
    price: '890 ₽/мес',
    features: ['Неограниченно документов', 'Приоритетная поддержка', 'История версий 12 мес.'],
    recommended: true,
  },
  {
    key: 'BUREAU',
    name: 'Бюро',
    storage: '50 ГБ',
    price: '2 490 ₽/мес',
    features: ['Командный доступ', 'API-интеграции', 'Выделенный менеджер'],
  },
]

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function StoragePage() {
  const [data, setData] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/storage')
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[120px]">
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return null

  const isWarning = data.percent > 68
  const currentPlan = PLANS.find((p) => p.key === data.plan) ?? PLANS[0]

  return (
    <div className="max-w-[860px]">
      <div className="mb-[24px]">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>
          Хранилище
        </h2>
      </div>

      {/* Предупреждение при >68% */}
      {isWarning && (
        <div
          className="flex items-start gap-[12px] rounded-[var(--radius-md)] mb-[20px] px-[16px] py-[12px]"
          style={{ background: 'oklch(0.96 0.025 20)', border: '1px solid oklch(0.88 0.04 20)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[1px]"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'var(--danger)' }}>
              Хранилище заполнено на {data.percent}%
            </p>
            <p className="text-[12px] mt-[2px]" style={{ color: 'oklch(0.5 0.08 20)' }}>
              Скоро места не останется. Перейдите на тариф «Дело» или «Бюро» чтобы расширить хранилище.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1fr_260px] gap-[20px] mb-[24px]">
        {/* Левая — чарт + breakdown */}
        <Card>
          <div className="flex items-center gap-[32px]">
            <DonutChart
              percent={data.percent}
              breakdown={data.breakdown}
              limitBytes={data.limitBytes}
            />

            <div className="flex-1">
              <div className="mb-[16px]">
                <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[4px]">
                  Использовано
                </p>
                <p className="text-[22px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatBytes(data.usedBytes)}
                  <span className="text-[14px] text-[var(--ink-4)] font-normal ml-[6px]">
                    из {formatLimit(data.limitBytes)}
                  </span>
                </p>
              </div>

              {/* Прогресс-бар */}
              <div className="w-full h-[6px] rounded-full bg-[var(--line)] overflow-hidden mb-[16px]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(data.percent, 100)}%`,
                    background: isWarning ? 'var(--danger)' : 'var(--accent)',
                  }}
                />
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

        {/* Правая — текущий тариф */}
        <Card>
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">
            Текущий тариф
          </p>
          <div className="flex items-center gap-[8px] mb-[14px]">
            <span
              className="inline-flex items-center px-[10px] h-[22px] rounded-full text-[11px] font-medium"
              style={{ background: 'var(--surface-inset)', color: 'var(--ink-2)' }}
            >
              {currentPlan.name}
            </span>
            <span className="text-[13px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
              {currentPlan.price}
            </span>
          </div>
          <div className="flex flex-col gap-[6px]">
            {currentPlan.features.map((f) => (
              <div key={f} className="flex items-center gap-[6px]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="oklch(0.45 0.1 145)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <p className="text-[12px] text-[var(--ink-3)]">{f}</p>
              </div>
            ))}
          </div>
          <div className="mt-[14px] pt-[14px]" style={{ borderTop: '1px solid var(--line)' }}>
            <p className="text-[11px] text-[var(--ink-4)]">
              Хранилище: <span className="font-medium text-[var(--ink-2)]">{currentPlan.storage}</span>
            </p>
          </div>
        </Card>
      </div>

      {/* Тарифы */}
      <p className="text-[13px] font-medium text-[var(--ink)] mb-[12px]">Тарифы</p>
      <div className="grid grid-cols-3 gap-[12px]">
        {PLANS.map((plan) => {
          const isCurrent = plan.key === data.plan
          return (
            <div
              key={plan.key}
              className="rounded-[var(--radius-lg)] relative"
              style={{
                padding: '20px',
                background: isCurrent ? 'var(--surface-inset)' : 'var(--bg)',
                border: `1px solid ${isCurrent ? 'var(--ink)' : 'var(--line)'}`,
              }}
            >
              {plan.recommended && !isCurrent && (
                <span
                  className="absolute top-[-10px] left-[50%] translate-x-[-50%] px-[10px] h-[20px] flex items-center rounded-full text-[10px] font-medium"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  Популярный
                </span>
              )}
              {isCurrent && (
                <span
                  className="absolute top-[-10px] left-[50%] translate-x-[-50%] px-[10px] h-[20px] flex items-center rounded-full text-[10px] font-medium"
                  style={{ background: 'var(--ink)', color: 'var(--bg)' }}
                >
                  Текущий
                </span>
              )}

              <p className="text-[15px] font-medium text-[var(--ink)] mb-[2px]">{plan.name}</p>
              <p className="text-[12px] text-[var(--ink-4)] mb-[14px]">{plan.storage} хранилища</p>

              <p className="text-[20px] font-medium text-[var(--ink)] mb-[14px]"
                style={{ fontFamily: 'var(--font-serif)' }}>
                {plan.price}
              </p>

              <div className="flex flex-col gap-[6px] mb-[16px]">
                {plan.features.map((f) => (
                  <div key={f} className="flex items-start gap-[6px]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                      stroke={isCurrent ? 'oklch(0.45 0.1 145)' : 'var(--ink-4)'}
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="shrink-0 mt-[2px]">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <p className="text-[11px] text-[var(--ink-3)] leading-[1.5]">{f}</p>
                  </div>
                ))}
              </div>

              <button
                disabled={isCurrent}
                className="w-full h-[34px] rounded-[var(--radius-md)] text-[12px] font-medium transition-all cursor-pointer disabled:cursor-default"
                style={{
                  background: isCurrent ? 'transparent' : 'var(--ink)',
                  color: isCurrent ? 'var(--ink-4)' : 'var(--bg)',
                  border: isCurrent ? '1px solid var(--line)' : 'none',
                }}
              >
                {isCurrent ? 'Активен' : 'Перейти'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Add-on блок */}
      <div
        className="mt-[16px] rounded-[var(--radius-lg)] flex items-center justify-between gap-[16px]"
        style={{ padding: '16px 20px', background: 'var(--surface-inset)', border: '1px solid var(--line)' }}
      >
        <div>
          <p className="text-[13px] font-medium text-[var(--ink)]">Дополнительное хранилище</p>
          <p className="text-[12px] text-[var(--ink-4)] mt-[2px]">
            Добавьте +100 ГБ к любому тарифу без смены плана
          </p>
        </div>
        <div className="flex items-center gap-[12px] shrink-0">
          <p className="text-[14px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
            490 ₽/мес
          </p>
          <button
            className="h-[34px] px-[14px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  )
}
