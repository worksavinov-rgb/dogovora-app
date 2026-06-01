'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DocumentRowSkeleton } from '@/components/ui/skeleton'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Counterparty { id: string; name: string; inn: string | null }
interface Version { id: string; number: number; status: string; fileSize: number | null; createdAt: string }
interface ParentDoc { id: string; title: string; number: string | null }
interface Profile { id: string; name: string; type: string }
interface Document {
  id: string; title: string; number: string | null; type: string
  updatedAt: string; counterparty: Counterparty
  profile: Profile | null
  versions: Version[]
  parentDocument: ParentDoc | null
  documentNumber: number | null
  _count: { versions: number; childDocuments: number }
}

type SortField = 'title' | 'type' | 'updatedAt' | 'versions'
type SortDir = 'asc' | 'desc'

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'ДС' }
const PROFILE_TYPE_SHORT: Record<string, string> = {
  SOLE_PROPRIETOR: 'ИП', COMPANY: 'ООО', INDIVIDUAL: 'Физ.', ANO: 'АНО', PAO: 'ПАО', ZAO: 'ЗАО',
}
const STATUS_MAP: Record<string, 'draft'|'progress'|'review'|'approved'|'paid'|'signed'> = {
  DRAFT:'draft', IN_PROGRESS:'progress', REVIEW:'review', APPROVED:'approved', PAID:'paid', SIGNED:'signed'
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

function sortDocs(docs: Document[], field: SortField, dir: SortDir): Document[] {
  return [...docs].sort((a, b) => {
    let cmp = 0
    if (field === 'title') cmp = a.title.localeCompare(b.title, 'ru')
    else if (field === 'type') cmp = a.type.localeCompare(b.type)
    else if (field === 'updatedAt') cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    else if (field === 'versions') cmp = a._count.versions - b._count.versions
    return dir === 'asc' ? cmp : -cmp
  })
}

/** Строит плоский упорядоченный массив для рендера: корень → его дети → следующий корень … */
function buildTree(docs: Document[], sortField: SortField, sortDir: SortDir): Array<{ doc: Document; depth: number }> {
  const roots = sortDocs(docs.filter((d) => !d.parentDocument), sortField, sortDir)
  const childrenOf = new Map<string, Document[]>()
  for (const d of docs) {
    if (d.parentDocument) {
      const arr = childrenOf.get(d.parentDocument.id) ?? []
      arr.push(d)
      childrenOf.set(d.parentDocument.id, arr)
    }
  }

  const result: Array<{ doc: Document; depth: number }> = []
  for (const root of roots) {
    result.push({ doc: root, depth: 0 })
    const children = (childrenOf.get(root.id) ?? []).sort((a, b) => (a.documentNumber ?? 0) - (b.documentNumber ?? 0))
    for (const child of children) result.push({ doc: child, depth: 1 })
  }
  return result
}

// ─── Модалка редактирования документа ────────────────────────────────────────

function EditDocumentModal({ doc, onClose, onSaved }: {
  doc: Document
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(doc.title)
  const [number, setNumber] = useState(doc.number ?? '')
  const [date, setDate] = useState(() => {
    const d = new Date(doc.updatedAt)
    return d.toISOString().slice(0, 10)
  })
  const [profileId, setProfileId] = useState(doc.profile?.id ?? '')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/profiles')
      .then((r) => r.ok ? r.json() : [])
      .then((list: Profile[]) => setProfiles(list))
      .catch(() => {})
  }, [])

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim() || doc.title,
        number: number.trim() || null,
        date: date || null,
        profileId: profileId || null,
      }),
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[400px]" style={{ padding: '28px' }}>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[20px]">
          Параметры документа
        </p>

        <div className="flex flex-col gap-[14px] mb-[24px]">
          <div>
            <label className="block text-[12px] text-[var(--ink-3)] mb-[6px]">Название</label>
            <input
              className="w-full h-[38px] px-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название документа"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--ink-3)] mb-[6px]">Номер договора</label>
            <input
              className="w-full h-[38px] px-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
              style={{ fontFamily: 'var(--font-mono)' }}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Например: 123/2026 (необязательно)"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--ink-3)] mb-[6px]">Дата подписания</label>
            <input
              type="date"
              className="w-full h-[38px] px-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {profiles.length > 0 && (
            <div>
              <label className="block text-[12px] text-[var(--ink-3)] mb-[6px]">Моя компания</label>
              <select
                className="w-full h-[38px] px-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors appearance-none cursor-pointer"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                <option value="">— не указана —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {PROFILE_TYPE_SHORT[p.type] ?? p.type} {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-[8px]">
          <button
            onClick={onClose}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
          >
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Модалка подписания ───────────────────────────────────────────────────────

function SignDocumentModal({ doc, versionId, onClose, onSigned }: {
  doc: Document
  versionId: string
  onClose: () => void
  onSigned: () => void
}) {
  const [number, setNumber] = useState(doc.number ?? '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  async function handleSign() {
    setSaving(true)
    await fetch(`/api/versions/${versionId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SIGNED', signedAt: date, number: number.trim() || undefined }),
    })
    setSaving(false)
    onSigned()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[400px]" style={{ padding: '28px' }}>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[6px]">
          Подписание договора
        </p>
        <p className="text-[13px] text-[var(--ink-3)] mb-[20px]">
          {doc.title}
        </p>

        <div className="flex flex-col gap-[14px] mb-[24px]">
          <div>
            <label className="block text-[12px] text-[var(--ink-3)] mb-[6px]">Номер договора</label>
            <input
              className="w-full h-[38px] px-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
              style={{ fontFamily: 'var(--font-mono)' }}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Например: 123/2026"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--ink-3)] mb-[6px]">Дата подписания</label>
            <input
              type="date"
              className="w-full h-[38px] px-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] mb-[20px] px-[12px] py-[10px]"
          style={{ background: 'oklch(0.96 0.03 155)', border: '1px solid oklch(0.88 0.05 155)' }}>
          <p className="text-[12px] text-[oklch(0.35_0.08_155)]">
            После подписания статус версии изменится на «Подписан» и номер договора будет зафиксирован.
          </p>
        </div>

        <div className="flex gap-[8px]">
          <button
            onClick={onClose}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            onClick={handleSign}
            disabled={saving}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
          >
            {saving ? 'Подписываю…' : 'Подписать'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Меню трёх точек для строки документа ────────────────────────────────────

function RowMenu({ doc, onStatusChange, onEdit, onSign }: {
  doc: Document
  onStatusChange: (docId: string, versionId: string, newStatus: string) => void
  onEdit: (doc: Document) => void
  onSign: (doc: Document, versionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const lastVer = doc.versions[0]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const canReview = lastVer && !['REVIEW', 'APPROVED', 'PAID', 'SIGNED'].includes(lastVer.status)
  const canApprove = lastVer && lastVer.status === 'REVIEW'
  const canSign = lastVer && lastVer.status === 'PAID'

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[32px] z-50 rounded-[var(--radius-md)] py-[4px] min-w-[180px]"
          style={{ background: 'white', border: '1px solid var(--line)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}
        >
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { router.push(`/documents/${doc.id}`); setOpen(false) }}
          >
            Открыть
          </button>
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { router.push(`/documents/${doc.id}/work`); setOpen(false) }}
          >
            Редактировать в ИИ
          </button>
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { onEdit(doc); setOpen(false) }}
          >
            Открыть карточку
          </button>
          {canReview && lastVer && (
            <>
              <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
              <button
                className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
                onClick={() => { onStatusChange(doc.id, lastVer.id, 'REVIEW'); setOpen(false) }}
              >
                Отправить на проверку
              </button>
            </>
          )}
          {canApprove && lastVer && (
            <button
              className="w-full text-left px-[14px] py-[8px] text-[13px] text-[oklch(0.45_0.1_145)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer font-medium"
              onClick={() => { onStatusChange(doc.id, lastVer.id, 'APPROVED'); setOpen(false) }}
            >
              ✓ Утвердить
            </button>
          )}
          {canSign && lastVer && (
            <>
              <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
              <button
                className="w-full text-left px-[14px] py-[8px] text-[13px] font-medium hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
                style={{ color: 'oklch(0.32 0.08 155)' }}
                onClick={() => { onSign(doc, lastVer.id); setOpen(false) }}
              >
                ✎ Подписать договор
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Заголовок колонки с сортировкой ─────────────────────────────────────────

function SortableHeader({ label, field, current, dir, onSort }: {
  label: string
  field: SortField
  current: SortField
  dir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = current === field
  return (
    <button
      className="flex items-center gap-[4px] text-[11px] font-medium uppercase tracking-[0.07em] cursor-pointer hover:text-[var(--ink)] transition-colors"
      style={{ color: active ? 'var(--ink)' : 'var(--ink-4)' }}
      onClick={() => onSort(field)}
    >
      {label}
      <span style={{ opacity: active ? 1 : 0.4 }}>
        {active && dir === 'asc' ? '↑' : '↓'}
      </span>
    </button>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const router = useRouter()
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [counterpartyFilter, setCounterpartyFilter] = useState('')
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [sortField, setSortField] = useState<SortField>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [editingDoc, setEditingDoc] = useState<Document | null>(null)
  const [signingDoc, setSigningDoc] = useState<{ doc: Document; versionId: string } | null>(null)

  // Загрузка контрагентов для фильтра
  useEffect(() => {
    fetch('/api/counterparties')
      .then((r) => r.ok ? r.json() : [])
      .then((list: Counterparty[]) => setCounterparties(list))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (typeFilter) p.set('type', typeFilter)
    if (statusFilter) p.set('status', statusFilter)
    if (counterpartyFilter) p.set('counterpartyId', counterpartyFilter)
    const res = await fetch(`/api/documents?${p}`)
    if (res.ok) setDocs(await res.json())
    setLoading(false)
  }, [q, typeFilter, statusFilter, counterpartyFilter])

  useEffect(() => { load() }, [load])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  async function handleStatusChange(docId: string, versionId: string, newStatus: string) {
    await fetch(`/api/versions/${versionId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    load()
  }

  const tree = buildTree(docs, sortField, sortDir)
  const totalVersions = docs.reduce((s, d) => s + d._count.versions, 0)

  return (
    <>
    {editingDoc && (
      <EditDocumentModal
        doc={editingDoc}
        onClose={() => setEditingDoc(null)}
        onSaved={load}
      />
    )}
    {signingDoc && (
      <SignDocumentModal
        doc={signingDoc.doc}
        versionId={signingDoc.versionId}
        onClose={() => setSigningDoc(null)}
        onSigned={load}
      />
    )}
    <div className="max-w-[1280px]">
      {/* Заголовок */}
      <div className="mb-[24px]">
        <p className="text-[12px] text-[var(--ink-4)] font-medium mb-[4px]">
          {docs.length} документов · {totalVersions} версий
        </p>
        <div className="flex items-start justify-between">
          <div>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:400, marginBottom:4 }}>Документы</h2>
            <p className="text-[14px] text-[var(--ink-3)]">Договоры, приложения и допсоглашения. Каждое изменение — новая версия.</p>
          </div>
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary" onClick={() => router.push('/documents/new?tab=upload')}>
              ↑ Загрузить
            </Button>
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
            placeholder="Поиск по названию"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <select
          className="h-[36px] px-[10px] pr-[28px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none appearance-none cursor-pointer focus:border-[var(--accent)] transition-colors"
          value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Тип: все</option>
          <option value="CONTRACT">Договор</option>
          <option value="APPENDIX">Приложение</option>
          <option value="AMENDMENT">Доп. соглашение</option>
        </select>

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

        {counterparties.length > 0 && (
          <select
            className="h-[36px] px-[10px] pr-[28px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none appearance-none cursor-pointer focus:border-[var(--accent)] transition-colors max-w-[180px]"
            value={counterpartyFilter} onChange={(e) => setCounterpartyFilter(e.target.value)}
          >
            <option value="">Контрагент: все</option>
            {counterparties.map((cp) => (
              <option key={cp.id} value={cp.id}>{cp.name}</option>
            ))}
          </select>
        )}

        {/* Сброс фильтров */}
        {(q || typeFilter || statusFilter || counterpartyFilter) && (
          <button
            onClick={() => { setQ(''); setTypeFilter(''); setStatusFilter(''); setCounterpartyFilter('') }}
            className="h-[36px] px-[10px] text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] rounded-[var(--radius-md)] transition-colors cursor-pointer"
          >
            × Сбросить
          </button>
        )}
      </div>

      {/* Таблица */}
      <Card pad={false}>
        {/* Шапка с сортировкой */}
        <div className="hidden md:grid grid-cols-[1fr_80px_100px_180px_180px_72px_130px_80px_60px_36px] gap-[8px] px-[16px] py-[10px] border-b border-[var(--line)] bg-[var(--surface-inset)] rounded-t-[var(--radius-lg)]">
          <SortableHeader label="Название" field="title" current={sortField} dir={sortDir} onSort={handleSort} />
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em]">№</p>
          <SortableHeader label="Тип" field="type" current={sortField} dir={sortDir} onSort={handleSort} />
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em]">Моя компания</p>
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em]">Контрагент</p>
          <SortableHeader label="Верс." field="versions" current={sortField} dir={sortDir} onSort={handleSort} />
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em]">Статус</p>
          <SortableHeader label="Обновлён" field="updatedAt" current={sortField} dir={sortDir} onSort={handleSort} />
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.07em]">Размер</p>
          <p />
        </div>

        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <DocumentRowSkeleton key={i} />)
        ) : tree.length === 0 ? (
          <div className="py-[64px] flex flex-col items-center gap-[12px]">
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <p className="text-[16px] text-[var(--ink-2)]" style={{ fontFamily: 'var(--font-serif)' }}>Документов пока нет</p>
            <p className="text-[13px] text-[var(--ink-4)]">Создайте первый договор или загрузите существующий</p>
            <Button variant="primary" onClick={() => router.push('/documents/new')}>+ Создать документ</Button>
          </div>
        ) : (
          tree.map(({ doc, depth }, i) => {
            const lastVer = doc.versions[0]
            const isChild = depth === 1
            const docNumber = doc.number
              ? doc.number
              : doc.documentNumber
                ? String(doc.documentNumber)
                : null
            return (
              <div
                key={doc.id}
                onClick={() => router.push(`/documents/${doc.id}`)}
                className={[
                  'cursor-pointer hover:bg-[var(--surface-2)] transition-colors items-center',
                  'flex gap-[12px] py-[10px] pr-[16px]',
                  'md:grid md:grid-cols-[1fr_80px_100px_180px_180px_72px_130px_80px_60px_36px] md:gap-[8px]',
                  i < tree.length - 1 ? 'border-b border-[var(--line)]' : '',
                  isChild ? 'bg-[var(--surface-inset)]' : '',
                ].join(' ')}
                style={{ paddingLeft: isChild ? 32 : 16 }}
              >
                {/* Название */}
                <div className="flex items-center gap-[8px] min-w-0 flex-1">
                  {isChild && (
                    <span className="shrink-0 text-[var(--ink-4)] text-[11px] leading-none">↳</span>
                  )}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke={isChild ? 'var(--accent)' : 'var(--ink-4)'}
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <div className="min-w-0">
                    <p className={['truncate font-medium', isChild ? 'text-[12px] text-[var(--ink-2)]' : 'text-[13px] text-[var(--ink)]'].join(' ')}>
                      {doc.title}
                    </p>
                    {!isChild && doc._count.childDocuments > 0 && (
                      <p className="text-[11px] text-[var(--ink-4)]">
                        {doc._count.childDocuments} {doc._count.childDocuments === 1 ? 'вложение' : doc._count.childDocuments < 5 ? 'вложения' : 'вложений'}
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--ink-4)] truncate md:hidden">{doc.counterparty.name}</p>
                  </div>
                </div>
                {/* Номер */}
                <p className="hidden md:block text-[12px] text-[var(--ink-3)] truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                  {docNumber ?? '—'}
                </p>
                {/* Тип */}
                <p className="hidden md:block text-[12px] text-[var(--ink-3)]">{TYPE_LABELS[doc.type] ?? doc.type}</p>
                {/* Моя компания */}
                <div className="hidden md:flex items-start gap-[5px]">
                  {doc.profile ? (
                    <>
                      <span className="shrink-0 text-[10px] font-semibold px-[5px] py-[1px] rounded bg-[oklch(0.92_0.05_280)] text-[oklch(0.35_0.1_280)] mt-[1px]">
                        {PROFILE_TYPE_SHORT[doc.profile.type] ?? doc.profile.type}
                      </span>
                      <p className="text-[12px] text-[var(--ink-3)] leading-[1.4]">{doc.profile.name}</p>
                    </>
                  ) : (
                    <p className="text-[12px] text-[var(--ink-4)]">—</p>
                  )}
                </div>
                {/* Контрагент */}
                <div className="hidden md:block">
                  <p className="text-[12px] text-[var(--ink-3)] leading-[1.4]">{doc.counterparty.name}</p>
                </div>
                {/* Версии */}
                <p className="hidden md:block text-[12px] text-[var(--ink-4)]" style={{ fontFamily:'var(--font-mono)' }}>
                  {lastVer ? `v.${lastVer.number}` : '—'}
                </p>
                {/* Статус */}
                <div className="shrink-0">
                  {lastVer && <StatusBadge status={STATUS_MAP[lastVer.status] ?? 'draft'} />}
                </div>
                {/* Обновлён */}
                <p className="hidden md:block text-[12px] text-[var(--ink-3)]">{relDate(doc.updatedAt)}</p>
                {/* Размер */}
                <p className="hidden md:block text-[12px] text-[var(--ink-4)]">{formatSize(lastVer?.fileSize ?? null)}</p>
                {/* Меню */}
                <RowMenu
                  doc={doc}
                  onStatusChange={handleStatusChange}
                  onEdit={setEditingDoc}
                  onSign={(d, vId) => setSigningDoc({ doc: d, versionId: vId })}
                />
              </div>
            )
          })
        )}
      </Card>
    </div>
    </>
  )
}
