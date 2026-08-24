'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'

interface ActRow {
  id: string
  shortName: string
  number: string
  lastCheckedAt: string | null
  isActive: boolean
  alertCount: number
  newCount: number
}

interface AlertRow {
  id: string
  actShortName: string
  eoNumber: string
  complexName: string
  documentDate: string
  status: string
  sourceUrl: string
}

interface LegalData {
  acts: ActRow[]
  alerts: AlertRow[]
  normsCount: number
  alertsLimit: number
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Новая',
  REVIEWED: 'Просмотрена',
  APPLIED: 'Учтена',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function AdminLegalPage() {
  const [data, setData] = useState<LegalData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/legal')
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? 'Нет доступа' : 'Не удалось загрузить данные')
        return res.json() as Promise<LegalData>
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return <div className="p-8 text-[13px] text-[var(--danger)]">{error}</div>
  }
  if (!data) {
    return <div className="p-8 text-[13px] text-[var(--ink-4)]">Загрузка юридической базы…</div>
  }

  const totalNew = data.acts.reduce((sum, a) => sum + a.newCount, 0)

  return (
    <div className="p-[24px] max-w-[1100px] space-y-[20px]">
      <div>
        <h1 className="font-[var(--font-display)] text-[28px] font-semibold text-[var(--ink)] tracking-[-0.02em]">
          Юридическая база
        </h1>
        <p className="text-[13px] text-[var(--ink-4)] mt-1">
          Отслеживание изменений законодательства по данным официального портала
          правовой информации. База используется ИИ при работе с договорами.
        </p>
      </div>

      {/* ─── Сводка ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px]">
        <Card className="p-[16px]">
          <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-wide">Отслеживается актов</p>
          <p className="font-[var(--font-mono)] text-[24px] text-[var(--ink)] mt-1">{data.acts.length}</p>
        </Card>
        <Card className="p-[16px]">
          <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-wide">Статей в базе</p>
          <p className="font-[var(--font-mono)] text-[24px] text-[var(--ink)] mt-1">{data.normsCount}</p>
          {data.normsCount === 0 && (
            <p className="text-[11px] text-[var(--ink-3)] mt-1">Тексты актов ещё не загружены</p>
          )}
        </Card>
        <Card className="p-[16px]">
          <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-wide">Новых поправок</p>
          <p className="font-[var(--font-mono)] text-[24px] text-[var(--ink)] mt-1">{totalNew}</p>
        </Card>
      </div>

      {/* ─── Отслеживаемые акты ─────────────────────────────────────────── */}
      <Card className="p-[20px]">
        <h2 className="text-[15px] font-medium text-[var(--ink)] mb-[12px]">Отслеживаемые акты</h2>
        {data.acts.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-4)]">Реестр пуст.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-[var(--ink-4)] uppercase tracking-wide border-b border-[var(--line)]">
                  <th className="py-2 pr-4 font-medium">Акт</th>
                  <th className="py-2 pr-4 font-medium">Номер</th>
                  <th className="py-2 pr-4 font-medium">Последняя проверка</th>
                  <th className="py-2 pr-4 font-medium">Поправок найдено</th>
                </tr>
              </thead>
              <tbody>
                {data.acts.map((a) => (
                  <tr key={a.id} className="border-b border-[var(--line)]">
                    <td className="py-3 pr-4 text-[var(--ink)]">{a.shortName}</td>
                    <td className="py-3 pr-4 font-[var(--font-mono)] text-[var(--ink-4)]">{a.number}</td>
                    <td className="py-3 pr-4 text-[var(--ink-4)]">
                      {a.lastCheckedAt ? formatDate(a.lastCheckedAt) : 'ещё не проверялся'}
                    </td>
                    <td className="py-3 pr-4 font-[var(--font-mono)]">
                      {a.alertCount}
                      {a.newCount > 0 && (
                        <span className="ml-2 text-[11px] text-[var(--accent)]">
                          новых: {a.newCount}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Найденные поправки ─────────────────────────────────────────── */}
      <Card className="p-[20px]">
        <h2 className="text-[15px] font-medium text-[var(--ink)] mb-[12px]">Найденные поправки</h2>
        {data.alerts.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-4)]">
            Пока ничего не найдено — синхронизация ещё не запускалась.
          </p>
        ) : (
          <>
            <div className="space-y-[10px]">
              {data.alerts.map((al) => (
                <div key={al.id} className="border-b border-[var(--line)] pb-[10px] last:border-0">
                  <div className="flex items-baseline gap-[8px] flex-wrap">
                    <span className="text-[13px] font-medium text-[var(--ink)]">{al.actShortName}</span>
                    <span className="font-[var(--font-mono)] text-[11px] text-[var(--ink-4)]">
                      {formatDate(al.documentDate)}
                    </span>
                    <span className="text-[11px] text-[var(--ink-3)]">
                      {STATUS_LABEL[al.status] ?? al.status}
                    </span>
                  </div>
                  <p className="text-[13px] text-[var(--ink-2)] mt-1">{al.complexName}</p>
                  <a
                    href={al.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--accent)] hover:underline"
                  >
                    Официальная публикация ↗
                  </a>
                </div>
              ))}
            </div>
            {data.alerts.length >= data.alertsLimit && (
              <p className="text-[11px] text-[var(--ink-3)] mt-[12px]">
                Показаны последние {data.alertsLimit} — более ранние не выводятся.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
