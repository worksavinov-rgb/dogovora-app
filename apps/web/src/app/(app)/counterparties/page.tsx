'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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

function CounterpartyMenu({ cp, onRefresh }: { cp: Counterparty; onRefresh: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handle = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(false)
    action()
  }

  const archive = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(false)
    await fetch(`/api/counterparties/${cp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: !cp.isArchived }),
    })
    onRefresh()
  }

  const del = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Удалить контрагента «${cp.name}»? Это действие нельзя отменить.`)) return
    setOpen(false)
    await fetch(`/api/counterparties/${cp.id}`, { method: 'DELETE' })
    onRefresh()
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={['w-[32px] h-[32px] flex items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer', open ? 'bg-[var(--surface-2)] text-[var(--ink)]' : 'text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)]'].join(' ')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-[36px] z-50 w-[200px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] shadow-lg py-[4px]">
          <button
            onClick={handle(() => router.push(`/counterparties/${cp.id}`))}
            className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer text-left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Открыть карточку
          </button>
          <button
            onClick={handle(() => router.push(`/documents/new?counterpartyId=${cp.id}`))}
            className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer text-left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            Создать документ
          </button>
          {cp.inn && (
            <button
              onClick={handle(() => navigator.clipboard.writeText(cp.inn!))}
              className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer text-left"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Скопировать ИНН
            </button>
          )}
          <div className="border-t border-[var(--line)] my-[4px]" />
          <button
            onClick={archive}
            className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer text-left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            {cp.isArchived ? 'Разархивировать' : 'В архив'}
          </button>
          <button
            onClick={del}
            className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-[13px] text-[var(--danger)] hover:bg-[oklch(0.97_0.02_25)] transition-colors cursor-pointer text-left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Удалить
          </button>
        </div>
      )}
    </div>
  )
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
  const [tab, setTab] = useState<'all' | 'archive'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    // 'all' и 'active' — оба показывают не-архивных; 'archive' — только архивных
    if (tab === 'archive') params.set('status', 'archive')
    else params.set('status', 'active')
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
          {([['all', 'Все'], ['archive', 'Архив']] as const).map(([key, label]) => (
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
              {q ? 'Ничего не найдено' : tab === 'archive' ? 'Архив пуст' : 'Контрагентов пока нет'}
            </p>
            <p className="text-[13px] text-[var(--ink-4)]">
              {q ? 'Попробуйте изменить запрос' : tab === 'archive' ? 'Контрагенты, которых вы отправите в архив, появятся здесь' : 'Добавьте первого контрагента чтобы начать'}
</p>
            {!q && tab !== 'archive' && <Button variant="primary" onClick={() => router.push('/counterparties/new')}>+ Добавить контрагента</Button>}
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
                <CounterpartyMenu cp={cp} onRefresh={load} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
