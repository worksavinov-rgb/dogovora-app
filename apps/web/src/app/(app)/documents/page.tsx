'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DocumentRowSkeleton, Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { DocumentNumberField } from '@/components/document-number-field'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Counterparty { id: string; name: string; inn: string | null }
interface Version { id: string; number: number; status: string; fileSize: number | null; createdAt: string; purchase?: { id: string } | null }
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

type SortField = 'title' | 'number' | 'type' | 'updatedAt' | 'versions'
type SortDir = 'asc' | 'desc'

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'ДС' }
const PROFILE_TYPE_SHORT: Record<string, string> = {
  SOLE_PROPRIETOR: 'ИП', COMPANY: 'ООО', INDIVIDUAL: 'Физ.', ANO: 'АНО', PAO: 'ПАО', ZAO: 'ЗАО',
}
// Legacy-статус PAID больше не показываем как «Оплачено» — маппим в «Согласован».
const STATUS_MAP: Record<string, 'draft'|'progress'|'review'|'approved'|'signed'> = {
  DRAFT:'draft', IN_PROGRESS:'progress', REVIEW:'review', APPROVED:'approved', PAID:'approved', SIGNED:'signed'
}
// Канонические статусы: любой можно выставить вручную. SIGNED идёт через модалку
// подписания (проставляет номер/дату), остальные — прямой сменой статуса.
const STATUS_FLOW: Array<{ value: string; label: string }> = [
  { value: 'DRAFT', label: 'Черновик' },
  { value: 'IN_PROGRESS', label: 'В работе' },
  { value: 'REVIEW', label: 'На согласовании' },
  { value: 'APPROVED', label: 'Согласован' },
  { value: 'SIGNED', label: 'Подписан' },
]

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
    // Номер — отдельной веткой: документы без номера всегда уезжают в конец
    // списка, при любом направлении сортировки.
    if (field === 'number') {
      const an = a.number?.trim() ?? ''
      const bn = b.number?.trim() ?? ''
      if (!an && !bn) return 0
      if (!an) return 1
      if (!bn) return -1
      // numeric: true — иначе «10/08-26» встал бы перед «9/08-26»
      const numCmp = an.localeCompare(bn, 'ru', { numeric: true })
      return dir === 'asc' ? numCmp : -numCmp
    }
    let cmp = 0
    if (field === 'title') cmp = a.title.localeCompare(b.title, 'ru')
    else if (field === 'type') cmp = a.type.localeCompare(b.type)
    else if (field === 'updatedAt') cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    else if (field === 'versions') cmp = a._count.versions - b._count.versions
    return dir === 'asc' ? cmp : -cmp
  })
}

/** Строит плоский упорядоченный массив для рендера: корень → его дети → следующий корень … */
function buildTree(docs: Document[], sortField: SortField, sortDir: SortDir): Array<{ doc: Document; depth: number; parentId: string | null }> {
  // Множество id документов, реально присутствующих в текущем наборе (после фильтров).
  const present = new Set(docs.map((d) => d.id))
  // Корень для отрисовки — документ БЕЗ родителя ЛИБО «осиротевший»: его родитель
  // отфильтрован и в набор не попал (например, фильтр по типу «Приложение»
  // оставляет только приложения — их родительские договоры отсутствуют).
  const roots = sortDocs(
    docs.filter((d) => !d.parentDocument || !present.has(d.parentDocument.id)),
    sortField,
    sortDir,
  )
  // Дети строятся только для родителей, присутствующих в наборе — иначе
  // осиротевший ребёнок задвоился бы (и как корень, и как чей-то потомок).
  const childrenOf = new Map<string, Document[]>()
  for (const d of docs) {
    if (d.parentDocument && present.has(d.parentDocument.id)) {
      const arr = childrenOf.get(d.parentDocument.id) ?? []
      arr.push(d)
      childrenOf.set(d.parentDocument.id, arr)
    }
  }

  const result: Array<{ doc: Document; depth: number; parentId: string | null }> = []
  for (const root of roots) {
    result.push({ doc: root, depth: 0, parentId: null })
    const children = (childrenOf.get(root.id) ?? []).sort((a, b) => (a.documentNumber ?? 0) - (b.documentNumber ?? 0))
    for (const child of children) result.push({ doc: child, depth: 1, parentId: root.id })
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
          {/* excludeDocumentId — иначе документ найдёт сам себя как дубль номера */}
          <DocumentNumberField
            profileId={profileId || null}
            signingDate={date || null}
            value={number}
            onChange={setNumber}
            excludeDocumentId={doc.id}
          />
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
          <DocumentNumberField
            profileId={doc.profile?.id ?? null}
            signingDate={date || null}
            value={number}
            onChange={setNumber}
            excludeDocumentId={doc.id}
          />
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

// ─── Модалка привязки документа к другому документу ─────────────────────────

function LinkDocumentModal({ doc, allDocs, onClose, onLinked }: {
  doc: Document
  allDocs: Document[]
  onClose: () => void
  onLinked: () => void
}) {
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  // Документы доступные для привязки: не сам, не потомки (только depth=0 проверяем на уровне UI — глубокие циклы блокирует сервер)
  const candidates = allDocs.filter((d) => d.id !== doc.id)

  const filtered = q.trim()
    ? candidates.filter((d) => d.title.toLowerCase().includes(q.toLowerCase()) || (d.number ?? '').toLowerCase().includes(q.toLowerCase()))
    : candidates

  async function link(parentId: string | null) {
    setSaving(true)
    await fetch(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentDocumentId: parentId }),
    })
    setSaving(false)
    onLinked()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[480px] flex flex-col"
        style={{ maxHeight: 'min(600px, 80vh)' }}
      >
        {/* Шапка — фиксирована */}
        <div style={{ padding: '24px 24px 0' }}>
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">
            Привязать к документу
          </p>

          {/* Текущий документ */}
          <div className="flex items-center gap-[8px] mb-[14px] px-[10px] py-[8px] rounded-[var(--radius-md)]"
            style={{ background: 'var(--surface-inset)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--ink)] truncate">{doc.title}</p>
              <p className="text-[11px] text-[var(--ink-4)]">{TYPE_LABELS[doc.type] ?? doc.type}</p>
            </div>
          </div>

          {/* Текущий пакет (если есть родитель) */}
          {doc.parentDocument && (
            <div className="rounded-[var(--radius-md)] mb-[12px] px-[12px] py-[10px] flex items-center justify-between gap-[12px]"
              style={{ border: '1px solid var(--line-2)' }}>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-[var(--ink-4)] mb-[1px]">Текущий пакет</p>
                <p className="text-[13px] text-[var(--ink)] truncate">{doc.parentDocument.title}</p>
              </div>
              <button
                onClick={() => link(null)}
                disabled={saving}
                className="shrink-0 h-[30px] px-[10px] text-[12px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-40"
              >
                Отвязать
              </button>
            </div>
          )}

          {/* Поиск */}
          <div className="relative mb-[8px]">
            <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--ink-4)]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </span>
            <input
              className="w-full h-[36px] pl-[32px] pr-[12px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
              placeholder="Поиск по названию или номеру"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>

          <p className="text-[11px] text-[var(--ink-4)] mb-[6px] px-[2px]">
            {filtered.length} {filtered.length === 1 ? 'документ' : filtered.length < 5 ? 'документа' : 'документов'}
          </p>
        </div>

        {/* Список — скроллится */}
        <div className="overflow-y-auto flex-1" style={{ padding: '0 16px' }}>
          {filtered.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-4)] py-[16px] text-center">Ничего не найдено</p>
          ) : (
            filtered.map((d) => {
              const isCurrent = doc.parentDocument?.id === d.id
              return (
                <button
                  key={d.id}
                  onClick={() => !saving && link(d.id)}
                  disabled={saving || isCurrent}
                  className={[
                    'w-full text-left px-[10px] py-[9px] rounded-[var(--radius-md)] transition-colors',
                    isCurrent ? 'bg-[var(--surface-inset)] cursor-default' : 'hover:bg-[var(--surface-inset)] cursor-pointer',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-[10px]">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke={isCurrent ? 'var(--accent)' : 'var(--ink-4)'}
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[var(--ink)] truncate font-medium">{d.title}</p>
                      <p className="text-[11px] text-[var(--ink-4)] truncate">
                        {TYPE_LABELS[d.type] ?? d.type}
                        {d.number ? ` · ${d.number}` : ''}
                        {' · '}{d.counterparty.name}
                      </p>
                    </div>
                    {isCurrent && (
                      <span className="shrink-0 text-[10px] font-medium px-[6px] py-[2px] rounded"
                        style={{ background: 'oklch(0.92 0.05 260)', color: 'var(--accent)' }}>
                        текущий
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Кнопка — фиксирована внизу */}
        <div style={{ padding: '12px 24px 20px' }}>
          <button
            onClick={onClose}
            className="w-full h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Модалка быстрого просмотра документа (только чтение) ───────────────────

function DocumentPreviewDialog({ doc, onEdit, onClose }: {
  doc: Document
  onEdit: () => void
  onClose: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const lastVer = doc.versions[0]

  useEffect(() => {
    if (!lastVer) { setLoading(false); setError(true); return }
    let active = true
    setLoading(true)
    setError(false)
    fetch(`/api/versions/${lastVer.id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { content: string | null }) => { if (active) setContent(data.content ?? '') })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [lastVer])

  // Закрытие по Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Сгенерированные DOCX хранятся как HTML, простой текст — как есть.
  const isHtml = content != null && /<(p|h[1-6]|strong|em|ul|ol|li|table|br|div|span)\b/i.test(content.slice(0, 500))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[24px]" style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-full max-w-[760px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* Шапка */}
        <div className="flex items-center justify-between gap-[12px] px-[24px] py-[16px] border-b border-[var(--line)] shrink-0">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-[var(--ink)] truncate">{doc.title}</p>
            <p className="text-[11px] text-[var(--ink-4)] mt-[1px]">
              Быстрый просмотр{lastVer ? ` · v.${lastVer.number}` : ''} — только чтение
            </p>
          </div>
          <button onClick={onClose}
            className="shrink-0 w-[30px] h-[30px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Тело — прокручиваемый «лист» */}
        <div className="flex-1 overflow-y-auto px-[32px] py-[28px]" style={{ background: 'var(--surface)' }}>
          {loading ? (
            <div className="flex flex-col gap-[10px]">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[14px]" style={{ width: `${60 + ((i * 13) % 35)}%` }} />
              ))}
            </div>
          ) : error ? (
            <p className="text-[13px] text-[var(--danger)] text-center py-[40px]">Не удалось загрузить документ</p>
          ) : !content?.trim() ? (
            <p className="text-[13px] text-[var(--ink-4)] text-center py-[40px]">Документ пуст</p>
          ) : isHtml ? (
            <div className="uploaded-doc-html bg-white rounded-[var(--radius-md)] px-[40px] py-[36px]"
              style={{ border: '1px solid var(--line)' }}
              dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <pre className="bg-white rounded-[var(--radius-md)] px-[32px] py-[28px] text-[13px] leading-[1.7] text-[var(--ink)] whitespace-pre-wrap break-words"
              style={{ border: '1px solid var(--line)', fontFamily: 'var(--font-ui)' }}>
              {content}
            </pre>
          )}
        </div>

        {/* Подвал */}
        <div className="flex items-center justify-end gap-[8px] px-[24px] py-[14px] border-t border-[var(--line)] shrink-0">
          <button onClick={onClose}
            className="h-[36px] px-[16px] rounded-[var(--radius-md)] text-[13px] bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            Закрыть
          </button>
          <button onClick={onEdit}
            className="h-[36px] px-[16px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer">
            Редактировать
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Меню трёх точек для строки документа ────────────────────────────────────

function RowMenu({ doc, onStatusChange, onPreview, onEdit, onSign, onDelete, onLink }: {
  doc: Document
  onStatusChange: (docId: string, versionId: string, newStatus: string) => void
  onPreview: (doc: Document) => void
  onEdit: (doc: Document) => void
  onSign: (doc: Document, versionId: string) => void
  onDelete: (doc: Document) => void
  onLink: (doc: Document) => void
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

  function handleOpen() {
    setOpen((v) => !v)
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleOpen}
        className="shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>

      {open && (() => {
        const rect = ref.current?.getBoundingClientRect()
        const goUp = rect ? rect.top > window.innerHeight - rect.bottom : false
        return <div
          className="absolute right-0 z-50 rounded-[var(--radius-md)] py-[4px] min-w-[180px]"
          style={{ background: 'white', border: '1px solid var(--line)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', ...(goUp ? { bottom: '32px' } : { top: '32px' }) }}
        >
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { onPreview(doc); setOpen(false) }}
          >
            Посмотреть
          </button>
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
            Редактировать
          </button>
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { onEdit(doc); setOpen(false) }}
          >
            Открыть карточку
          </button>

          {/* Выбор статуса */}
          <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
          <p className="px-[14px] pt-[4px] pb-[2px] text-[10px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em]">
            Статус
          </p>
          {/* Статус можно поменять у любого документа. Текущий помечен галочкой и
              не кликабелен. «Подписан» ведёт через модалку подписания (номер/дата),
              остальные — прямой сменой статуса. */}
          {STATUS_FLOW.map((s) => {
            const isCurrent = lastVer?.status === s.value
            return (
              <button
                key={s.value}
                disabled={!lastVer || isCurrent}
                className="w-full text-left px-[14px] py-[7px] text-[13px] flex items-center gap-[8px] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                style={{ color: isCurrent ? 'var(--accent)' : 'var(--ink)' }}
                onClick={() => {
                  if (!lastVer || isCurrent) return
                  if (s.value === 'SIGNED') onSign(doc, lastVer.id)
                  else onStatusChange(doc.id, lastVer.id, s.value)
                  setOpen(false)
                }}
              >
                <span className="w-[12px] shrink-0 text-[var(--accent)]">{isCurrent ? '✓' : ''}</span>
                {s.label}
              </button>
            )
          })}
          <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { onLink(doc); setOpen(false) }}
          >
            {doc.parentDocument ? '↗ Переместить в пакет' : '⊕ Привязать к документу'}
          </button>
          <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] font-medium hover:bg-[oklch(0.97_0.015_20)] transition-colors cursor-pointer"
            style={{ color: 'var(--danger)' }}
            onClick={() => { onDelete(doc); setOpen(false) }}
          >
            Удалить документ
          </button>
        </div>
      })()}
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
  const [view, setView] = useState<'all' | 'archive'>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [counterpartyFilter, setCounterpartyFilter] = useState('')
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [sortField, setSortField] = useState<SortField>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [editingDoc, setEditingDoc] = useState<Document | null>(null)
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  const [signingDoc, setSigningDoc] = useState<{ doc: Document; versionId: string } | null>(null)
  const [linkingDoc, setLinkingDoc] = useState<Document | null>(null)
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100
  const [deleteConfirm, setDeleteConfirm] = useState<Document | null>(null)
  const { toast } = useToast()

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
    if (view === 'archive') p.set('archived', '1')
    const res = await fetch(`/api/documents?${p}`)
    if (res.ok) {
      const data: Document[] = await res.json()
      setDocs(data)
      // По умолчанию сворачиваем все корневые документы с вложениями —
      // список вложенных раскрывается только по клику на стрелку.
      setCollapsedRoots(new Set(
        data.filter((d) => !d.parentDocument && d._count.childDocuments > 0).map((d) => d.id)
      ))
    }
    setLoading(false)
  }, [q, typeFilter, statusFilter, counterpartyFilter, view])

  useEffect(() => { load() }, [load])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  async function handleStatusChange(docId: string, versionId: string, newStatus: string) {
    const res = await fetch(`/api/versions/${versionId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast(data.error ?? 'Не удалось изменить статус', 'error')
      return
    }
    toast('Статус обновлён', 'success')
    load()
  }

  async function handleDelete(doc: Document) {
    setDeleteConfirm(doc)
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    const res = await fetch(`/api/documents/${deleteConfirm.id}`, { method: 'DELETE' })
    setDeleteConfirm(null)
    if (!res.ok) { toast('Не удалось удалить документ', 'error'); return }
    toast('Документ удалён', 'success')
    load()
  }

  // Удаление ИЗ СПИСКА документов = документ целиком, со всеми версиями (и с
  // вложениями, если это корневой договор). Предупреждение это подчёркивает и
  // советует сперва проверить список версий.
  const delChildCount = deleteConfirm?._count.childDocuments ?? 0
  const delHasChildren = delChildCount > 0
  const delChildPhrase = delHasChildren
    ? ` ВМЕСТЕ С ${delChildCount} ${delChildCount === 1 ? 'вложенным документом' : delChildCount < 5 ? 'вложенными документами' : 'вложенными документами'} (приложения, допсоглашения)`
    : ''
  const delMessage = [
    `Из списка документ удаляется целиком — вместе со ВСЕМИ его версиями${delChildPhrase}.`,
    delHasChildren ? 'Вложенные приложения и допсоглашения будут удалены безвозвратно вместе с ним.' : null,
    'Если нужна только одна версия — откройте документ и удалите конкретную версию в списке версий.',
    'Восстановить будет нельзя.',
  ].filter(Boolean).join(' ')

  const tree = buildTree(docs, sortField, sortDir)
  const visibleTree = tree.filter(({ parentId }) => !parentId || !collapsedRoots.has(parentId))
  const totalVersions = docs.reduce((s, d) => s + d._count.versions, 0)
  const totalPages = Math.max(1, Math.ceil(visibleTree.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = visibleTree.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggleCollapse(docId: string) {
    setCollapsedRoots((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  return (
    <>
    <ConfirmDialog
      open={!!deleteConfirm}
      title={delHasChildren ? `Удалить «${deleteConfirm?.title ?? ''}» и вложения?` : `Удалить «${deleteConfirm?.title ?? ''}»?`}
      message={delMessage}
      confirmLabel="Удалить"
      onConfirm={confirmDelete}
      onCancel={() => setDeleteConfirm(null)}
    />
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
    {linkingDoc && (
      <LinkDocumentModal
        doc={linkingDoc}
        allDocs={docs}
        onClose={() => setLinkingDoc(null)}
        onLinked={load}
      />
    )}
    {previewDoc && (
      <DocumentPreviewDialog
        doc={previewDoc}
        onEdit={() => { const id = previewDoc.id; setPreviewDoc(null); router.push(`/documents/${id}/work`) }}
        onClose={() => setPreviewDoc(null)}
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
            <Button variant="secondary" onClick={() => router.push('/documents/upload')}>
              ↑ Загрузить · бесплатно
            </Button>
            <Button variant="primary" onClick={() => router.push('/documents/new')}>+ Создать договор</Button>
          </div>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-[8px] mb-[16px] flex-wrap">
        <div className="flex gap-0 mr-[4px]">
          {([['all', 'Все'], ['archive', 'Архив']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setView(key); setPage(1) }}
              className={['px-[14px] h-[36px] text-[13px] font-medium rounded-[var(--radius-md)] transition-colors cursor-pointer', view === key ? 'bg-[var(--surface-2)] text-[var(--ink)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]'].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--ink-4)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            className="h-[36px] pl-[32px] pr-[12px] w-[220px] text-[13px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--ink-4)]"
            placeholder="Поиск по названию или номеру"
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
          <option value="REVIEW">На согласовании</option>
          <option value="APPROVED">Согласован</option>
          <option value="SIGNED">Подписан</option>
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
            onClick={() => { setQ(''); setTypeFilter(''); setStatusFilter(''); setCounterpartyFilter(''); setPage(1) }}
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
          <SortableHeader label="№" field="number" current={sortField} dir={sortDir} onSort={handleSort} />
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
            <p className="text-[16px] text-[var(--ink-2)]" style={{ fontFamily: 'var(--font-serif)' }}>
              {view === 'archive' ? 'Архив пуст' : 'Документов пока нет'}
            </p>
            <p className="text-[13px] text-[var(--ink-4)]">
              {view === 'archive' ? 'Документы контрагентов, которых вы отправите в архив, появятся здесь' : 'Создайте первый договор или загрузите существующий'}
            </p>
            {view !== 'archive' && (
              <div className="flex items-center gap-[8px] justify-center">
                <Button variant="secondary" onClick={() => router.push('/documents/upload')}>↑ Загрузить · бесплатно</Button>
                <Button variant="primary" onClick={() => router.push('/documents/new')}>+ Создать договор</Button>
              </div>
            )}
          </div>
        ) : (
          pageRows.map(({ doc, depth }, i) => {
            const lastVer = doc.versions[0]
            const isChild = depth === 1
            const hasChildren = doc._count.childDocuments > 0
            const isCollapsed = collapsedRoots.has(doc.id)
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
                  i < pageRows.length - 1 ? 'border-b border-[var(--line)]' : '',
                  isChild ? 'bg-[var(--surface-inset)]' : '',
                ].join(' ')}
                style={{ paddingLeft: isChild ? 32 : 16 }}
              >
                {/* Название */}
                <div className="flex items-center gap-[8px] min-w-0 flex-1">
                  {isChild && (
                    <span className="shrink-0 text-[var(--ink-4)] text-[11px] leading-none">↳</span>
                  )}
                  {!isChild && hasChildren ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(doc.id) }}
                      className="shrink-0 w-[16px] h-[16px] flex items-center justify-center text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      title={isCollapsed ? 'Развернуть' : 'Свернуть'}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                        <path d="M2 3.5L5 6.5L8 3.5"/>
                      </svg>
                    </button>
                  ) : !isChild ? (
                    <span className="shrink-0 w-[16px]" />
                  ) : null}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke={isChild ? 'var(--accent)' : 'var(--ink-4)'}
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <div className="min-w-0">
                    {/* Название переносится по строкам, а не обрезается многоточием:
                        имена загруженных файлов длинные и состоят из одного «слова»
                        с подчёркиваниями («Договора_ИП_Топчий_и_Фонд…»), и в
                        обрезанном виде документы не отличить друг от друга.
                        overflow-wrap: anywhere разрывает и такое сплошное слово. */}
                    <p
                      className={['font-medium', isChild ? 'text-[12px] text-[var(--ink-2)]' : 'text-[13px] text-[var(--ink)]'].join(' ')}
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {doc.title}
                    </p>
                    {!isChild && hasChildren && (
                      <p className="text-[11px] text-[var(--ink-4)]">
                        {isCollapsed
                          ? `▸ ${doc._count.childDocuments} ${doc._count.childDocuments === 1 ? 'вложение' : doc._count.childDocuments < 5 ? 'вложения' : 'вложений'}`
                          : `${doc._count.childDocuments} ${doc._count.childDocuments === 1 ? 'вложение' : doc._count.childDocuments < 5 ? 'вложения' : 'вложений'}`
                        }
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
                  onPreview={setPreviewDoc}
                  onEdit={setEditingDoc}
                  onSign={(d, vId) => setSigningDoc({ doc: d, versionId: vId })}
                  onDelete={handleDelete}
                  onLink={setLinkingDoc}
                />
              </div>
            )
          })
        )}
      </Card>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-[16px]">
          <p className="text-[13px] text-[var(--ink-4)]">
            Строки {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, tree.length)} из {tree.length}
          </p>
          <div className="flex items-center gap-[4px]">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="h-[32px] px-[10px] text-[12px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="h-[32px] px-[10px] text-[12px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >‹</button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…')
                acc.push(p)
                return acc
              }, [])
              .map((p, idx) =>
                p === '…' ? (
                  <span key={`ellipsis-${idx}`} className="h-[32px] px-[8px] flex items-center text-[12px] text-[var(--ink-4)]">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={[
                      'h-[32px] min-w-[32px] px-[10px] text-[12px] rounded-[var(--radius-md)] border transition-colors cursor-pointer',
                      safePage === p
                        ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                        : 'border-[var(--line-2)] text-[var(--ink-3)] hover:bg-[var(--surface-2)]',
                    ].join(' ')}
                  >{p}</button>
                )
              )}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="h-[32px] px-[10px] text-[12px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >›</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="h-[32px] px-[10px] text-[12px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >»</button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
