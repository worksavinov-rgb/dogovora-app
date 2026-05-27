'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'

interface Counterparty { id: string; name: string; inn: string | null }
interface Version { id: string; number: number; status: string; fileSize: number | null; createdAt: string }
interface Document {
  id: string; title: string; number: string | null; type: string
  updatedAt: string; counterparty: Counterparty
  versions: Version[]
  _count: { versions: number }
}

const TYPE_LABELS: Record<string, string> = { CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'ДС' }
const STATUS_MAP: Record<string, 'draft'|'progress'|'review'|'approved'|'paid'> = {
  DRAFT:'draft', IN_PROGRESS:'progress', REVIEW:'review', APPROVED:'approved', PAID:'paid'
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} Б`
  return `${Math.round(bytes / 1024)} КБ`
}

function relDate(iso: string): string {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return `сегодня, ${d.toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit' })}`
  if (diff === 1) return 'вчера'
  return d.toLocaleDateString('ru', { day:'numeric', month:'short' })
}

export default function DocumentsPage() {
  const router = useRouter()
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (typeFilter) p.set('type', typeFilter)
    if (statusFilter) p.set('status', statusFilter)
    const res = await fetch(`/api/documents?${p}`)
    if (res.ok) setDocs(await res.json())
    setLoading(false)
  }, [q, typeFilter, statusFilter])

  useEffect(() => { load() }, [load])

  const totalVersions = docs.reduce((s, d) => s + d._count.versions, 0)

  return (
    <div className="max-w-[1080px]">
      {/* Заголовок */}
      <div className="mb-[24px]">
        <p className="text-[12px] text-[var(--ink-4)] font-medium mb-[4px]">
          {docs.length} ДОКУМЕНТОВ · {totalVersions} ВЕРСИЙ
        </p>
        <div className="flex items-start justify-between">
          <div>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:400, marginBottom:4 }}>Документы</h2>
            <p className="text-[14px] text-[var(--ink-3)]">Все договоры, приложения и дополнительные соглашения. Каждое существенное изменение становится новой версией.</p>
          </div>
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary">↑ Загрузить</Button>
            <Button variant="primary" onClick={() => router.push('/documents/new')}>+ Создать</Button>
          </div>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-[8px] mb-[16px] flex-wrap">
        <div className="relative">
          <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--ink-4)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            className="h-[36px] pl-[32px] pr-[12px] w-[220px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--ink-4)]"
            placeholder="Поиск по названию или контрагенту"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* Тип */}
        <select
          className="h-[36px] px-[10px] pr-[28px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none appearance-none cursor-pointer focus:border-[var(--accent)] transition-colors"
          value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Тип: все</option>
          <option value="CONTRACT">Договор</option>
          <option value="APPENDIX">Приложение</option>
          <option value="AMENDMENT">Доп. соглашение</option>
        </select>

        {/* Статус */}
        <select
          className="h-[36px] px-[10px] pr-[28px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none appearance-none cursor-pointer focus:border-[var(--accent)] transition-colors"
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Статус: любой</option>
          <option value="DRAFT">Черновик</option>
          <option value="IN_PROGRESS">В работе</option>
          <option value="REVIEW">На проверке</option>
          <option value="APPROVED">Утверждено</option>
          <option value="PAID">Оплачено</option>
        </select>
      </div>

      {/* Таблица */}
      <Card pad={false}>
        {/* Шапка */}
        <div className="grid grid-cols-[1fr_100px_180px_72px_130px_80px_60px_36px] gap-[8px] px-[16px] py-[10px] border-b border-[var(--line)] bg-[var(--surface-inset)] rounded-t-[var(--radius-lg)]">
          {['Название','Тип','Контрагент','Верс.','Статус','Обновлён','Размер',''].map((h) => (
            <p key={h} className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em]">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-[60px]">
            <div className="w-[20px] h-[20px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <div className="py-[60px] text-center">
            <p className="text-[14px] font-medium text-[var(--ink-2)] mb-[8px]">Документов пока нет</p>
            <p className="text-[13px] text-[var(--ink-4)] mb-[20px]">Создайте первый договор или загрузите существующий</p>
            <Button variant="secondary" onClick={() => router.push('/documents/new')}>Создать документ</Button>
          </div>
        ) : (
          docs.map((doc, i) => {
            const lastVer = doc.versions[0]
            return (
              <div
                key={doc.id}
                onClick={() => router.push(`/documents/${doc.id}`)}
                className={['grid grid-cols-[1fr_100px_180px_72px_130px_80px_60px_36px] gap-[8px] px-[16px] py-[12px] items-center cursor-pointer hover:bg-[var(--surface-2)] transition-colors', i < docs.length-1 ? 'border-b border-[var(--line)]' : ''].join(' ')}
              >
                {/* Название */}
                <div className="flex items-center gap-[8px] min-w-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <p className="text-[13px] font-medium text-[var(--ink)] truncate">{doc.title}</p>
                </div>
                {/* Тип */}
                <p className="text-[12px] text-[var(--ink-3)]">{TYPE_LABELS[doc.type] ?? doc.type}</p>
                {/* Контрагент */}
                <div className="flex items-center gap-[6px] min-w-0">
                  <Avatar name={doc.counterparty.name} size={20} />
                  <p className="text-[12px] text-[var(--ink-3)] truncate">{doc.counterparty.name}</p>
                </div>
                {/* Версия */}
                <p className="text-[12px] text-[var(--ink-4)]" style={{ fontFamily:'var(--font-mono)' }}>
                  {lastVer ? `v.${lastVer.number}` : '—'}
                </p>
                {/* Статус */}
                <div>
                  {lastVer && <StatusBadge status={STATUS_MAP[lastVer.status] ?? 'draft'} />}
                </div>
                {/* Обновлён */}
                <p className="text-[12px] text-[var(--ink-3)]">{relDate(doc.updatedAt)}</p>
                {/* Размер */}
                <p className="text-[12px] text-[var(--ink-4)]">{formatSize(lastVer?.fileSize ?? null)}</p>
                {/* Меню */}
                <button onClick={(e) => e.stopPropagation()} className="w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                  </svg>
                </button>
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}
