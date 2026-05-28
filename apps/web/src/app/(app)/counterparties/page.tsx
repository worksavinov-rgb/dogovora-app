'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { CounterpartyRowSkeleton } from '@/components/ui/skeleton'

interface Counterparty {
  id: string
  name: string
  inn: string | null
  isArchived: boolean
  updatedAt: string
  _count: { documents: number }
  versionCount: number
}

function guessOrgForm(cp: Counterparty): string {
  if (!cp.inn) return ''
  if (cp.inn.length === 10) return 'ООО'
  if (cp.inn.length === 12) return 'ИП'
  return ''
}

function relativeDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  if (diff < 7) return `${diff} дн. назад`
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

export default function CounterpartiesPage() {
  const router = useRouter()
  const [items, setItems] = useState<Counterparty[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | 'active' | 'archive'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (tab !== 'all') params.set('status', tab)
    const res = await fetch(`/api/counterparties?${params}`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }, [q, tab])

  useEffect(() => { load() }, [load])

  const totalDocs = items.reduce((s, c) => s + c._count.documents, 0)
  const totalVersions = items.reduce((s, c) => s + c.versionCount, 0)

  return (
    <div className="max-w-[1080px]">
      <div className="mb-[24px]">
        <p className="text-[12px] text-[var(--ink-4)] font-medium mb-[4px]">
          {items.length} КОНТРАГЕНТОВ · {totalDocs} ДОКУМЕНТОВ · {totalVersions} ВЕРСИЙ
        </p>
        <div className="flex items-start justify-between">
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Контрагенты</h2>
            <p className="text-[14px] text-[var(--ink-3)]">Все, с кем вы заключали или обсуждали договоры. По каждому — отдельная история документов и версий.</p>
          </div>
          <Button variant="primary" onClick={() => router.push('/counterparties/new')}>+ Новый контрагент</Button>
        </div>
      </div>

      {/* Поиск + табы */}
      <div className="flex items-center gap-[12px] mb-[16px]">
        <div className="relative flex-1 max-w-[320px]">
          <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--ink-4)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>
          <input
            className="w-full h-[38px] pl-[36px] pr-[12px] text-[14px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] focus:shadow-[var(--sh-focus)] transition-[border-color,box-shadow] duration-[120ms] placeholder:text-[var(--ink-4)]"
            placeholder="Поиск по названию или ИНН"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-0">
          {([['all', 'Все'], ['active', 'Активные'], ['archive', 'Архив']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={['px-[14px] h-[38px] text-[13px] font-medium rounded-[var(--radius-md)] transition-colors cursor-pointer', tab === key ? 'bg-[var(--surface-2)] text-[var(--ink)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]'].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Таблица */}
      <Card pad={false}>
        <div className="grid grid-cols-[1fr_140px_72px_72px_110px_40px] gap-[12px] px-[16px] py-[10px] border-b border-[var(--line)] bg-[var(--surface-inset)] rounded-t-[var(--radius-lg)]">
          {['Контрагент', 'ИНН', 'Док-в', 'Версий', 'Активность', ''].map((h) => (
            <p key={h} className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em]">{h}</p>
          ))}
        </div>

        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CounterpartyRowSkeleton key={i} />)
        ) : items.length === 0 ? (
          <div className="px-[20px] py-[64px] flex flex-col items-center gap-[12px]">
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <p className="text-[16px] text-[var(--ink-2)]" style={{ fontFamily: 'var(--font-serif)' }}>
              {q ? 'Ничего не найдено' : 'Контрагентов пока нет'}
            </p>
            <p className="text-[13px] text-[var(--ink-4)]">
              {q ? 'Попробуйте изменить запрос' : 'Добавьте первого контрагента чтобы начать'}
            </p>
            {!q && <Button variant="primary" onClick={() => router.push('/counterparties/new')}>+ Добавить контрагента</Button>}
          </div>
        ) : (
          <div>
            {items.map((cp, i) => (
              <div
                key={cp.id}
                onClick={() => router.push(`/counterparties/${cp.id}`)}
                className={['grid grid-cols-[1fr_140px_72px_72px_110px_40px] gap-[12px] px-[16px] py-[13px] cursor-pointer hover:bg-[var(--surface-2)] transition-colors items-center', i < items.length - 1 ? 'border-b border-[var(--line)]' : ''].join(' ')}
              >
                <div className="flex items-center gap-[10px] min-w-0">
                  <Avatar name={cp.name} size={32} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--ink)] truncate">{cp.name}</p>
                    <p className="text-[12px] text-[var(--ink-4)]">{guessOrgForm(cp)}</p>
                  </div>
                </div>
                <p className="text-[13px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-mono)' }}>{cp.inn ?? '—'}</p>
                <p className="text-[13px] font-medium text-[var(--ink)]">{cp._count.documents}</p>
                <p className="text-[13px] text-[var(--ink-2)]">{cp.versionCount}</p>
                <p className="text-[13px] text-[var(--ink-3)]">{relativeDate(cp.updatedAt)}</p>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="w-[32px] h-[32px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
