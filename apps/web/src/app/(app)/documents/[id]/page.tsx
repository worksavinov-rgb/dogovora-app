'use client'

import { useState, useEffect, use, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { parseDocxToHtml } from '@/lib/docx-to-html'
import { DocumentNumberField } from '@/components/document-number-field'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Purchase { id: string; amount: string }
interface Version {
  id: string; number: number; status: string
  fileSize: number | null; createdAt: string
  content: string | null
  aiSettings: {
    protectionLevel?: number; targetSize?: number
    customInstruction?: string; description?: string
  }
  purchase: Purchase | null
}
interface Signatory { id: string; fullName: string; position: string }
interface Counterparty { id: string; name: string; inn: string | null; signatories: Signatory[] }
interface ChildDoc { id: string; title: string; number: string | null; type: string; documentNumber: number | null }
interface Document {
  id: string; title: string; number: string | null; type: string
  documentNumber: number | null
  createdAt: string; updatedAt: string
  // Сроки действия — для напоминаний об истечении/автопролонгации
  expiresAt: string | null
  autoRenewal: boolean
  renewalNoticeDays: number | null
  counterparty: Counterparty
  // Своё юрлицо документа — от него зависит формат номера (GET /api/documents/:id его отдаёт)
  profile: { id: string } | null
  versions: Version[]
  parentDocument: { id: string; title: string; number: string | null } | null
  childDocuments: ChildDoc[]
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'Доп. соглашение' }
const STATUS_MAP: Record<string, 'draft'|'progress'|'review'|'approved'|'paid'|'signed'> = {
  DRAFT:'draft', IN_PROGRESS:'progress', REVIEW:'review', APPROVED:'approved', PAID:'paid', SIGNED:'signed'
}

function relDate(iso: string): string {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return `${d.toLocaleDateString('ru', {day:'numeric',month:'short'})}, ${d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}`
  if (diff === 1) return 'вчера'
  return d.toLocaleDateString('ru', { day:'numeric', month:'short' })
}

// ─── Карточка «Срок действия» ────────────────────────────────────────────────
// Дата окончания + автопролонгация. Заполняется вручную; на главной по этим
// полям строятся напоминания «истекает / продлится автоматически».

function ExpiryCard({ doc, onSaved }: { doc: Document; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expires, setExpires] = useState(doc.expiresAt ? doc.expiresAt.slice(0, 10) : '')
  const [auto, setAuto] = useState(doc.autoRenewal)
  const [noticeDays, setNoticeDays] = useState<string>(String(doc.renewalNoticeDays ?? 14))

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresAt: expires || null,
          autoRenewal: auto,
          renewalNoticeDays: auto ? (parseInt(noticeDays, 10) || 14) : null,
        }),
      })
      if (res.ok) { setEditing(false); onSaved() }
    } finally {
      setSaving(false)
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Card>
      <div className="flex items-center justify-between mb-[10px]">
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em]">Срок действия</p>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)] underline cursor-pointer">
            {doc.expiresAt ? 'Изменить' : 'Указать'}
          </button>
        )}
      </div>

      {!editing ? (
        doc.expiresAt ? (
          <div className="flex flex-col gap-[4px] text-[13px]">
            <div className="flex justify-between gap-[8px]">
              <p className="text-[var(--ink-4)]">Действует до</p>
              <p className="text-[var(--ink-2)]">{fmt(doc.expiresAt)}</p>
            </div>
            {doc.autoRenewal && (
              <p className="text-[12px] text-[var(--ink-4)] leading-[1.5]">
                Продлевается автоматически, отказ — за {doc.renewalNoticeDays ?? 14} дн. до окончания
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--ink-4)] leading-[1.5]">
            Укажите дату окончания — Догодок напомнит об истечении или автопролонгации.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-[10px]">
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] text-[var(--ink-4)]">Дата окончания</span>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)}
              className="h-[34px] px-[10px] rounded-[var(--radius-md)] border border-[var(--line-2)] bg-white text-[13px]" />
          </label>
          <label className="flex items-center gap-[8px] text-[12px] text-[var(--ink-2)] cursor-pointer">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Продлевается автоматически
          </label>
          {auto && (
            <label className="flex flex-col gap-[4px]">
              <span className="text-[11px] text-[var(--ink-4)]">За сколько дней заявить об отказе</span>
              <input type="number" min={1} max={365} value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)}
                className="h-[34px] px-[10px] rounded-[var(--radius-md)] border border-[var(--line-2)] bg-white text-[13px] w-[100px]" />
            </label>
          )}
          <div className="flex gap-[8px]">
            <button onClick={() => setEditing(false)} disabled={saving}
              className="flex-1 h-[32px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
              Отмена
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 h-[32px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Модалка подписания ───────────────────────────────────────────────────────

function SignModal({ ver, docId, docTitle, docNumber, profileId, onConfirm, onClose, loading }: {
  ver: Version; docId: string; docTitle: string; docNumber: string | null
  profileId: string | null
  onConfirm: (number: string, date: string) => void
  onClose: () => void; loading: boolean
}) {
  const [number, setNumber] = useState(docNumber ?? '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[400px]" style={{ padding: '28px' }}>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[6px]">
          Подписание договора
        </p>
        <p className="text-[13px] text-[var(--ink-3)] mb-[20px]">
          {docTitle} · v.{ver.number}
        </p>

        <div className="flex flex-col gap-[14px] mb-[20px]">
          {/* excludeDocumentId — иначе документ найдёт сам себя как дубль номера */}
          <DocumentNumberField
            profileId={profileId}
            signingDate={date || null}
            value={number}
            onChange={setNumber}
            excludeDocumentId={docId}
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
            После подписания статус версии изменится на «Подписан» и данные будут зафиксированы.
          </p>
        </div>

        <div className="flex gap-[8px]">
          <button onClick={onClose}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            Отмена
          </button>
          <button onClick={() => onConfirm(number.trim(), date)} disabled={loading}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40">
            {loading ? 'Подписываю…' : 'Подписать'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Меню трёх точек для версии ──────────────────────────────────────────────

function VersionMenu({ ver, doc, onStatusChange, onDeleted, onSign, onDeleteDocument }: {
  ver: Version
  doc: Document
  onStatusChange: (verId: string, status: string) => void
  onDeleted: (verId: string) => void
  onSign: (ver: Version) => void
  onDeleteDocument?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const ALL_STATUSES = [
    { key: 'DRAFT',       label: 'Черновик',         color: 'var(--ink-3)' },
    { key: 'IN_PROGRESS', label: 'В работе',          color: 'oklch(0.5 0.1 220)' },
    { key: 'REVIEW',      label: 'На проверке',       color: 'oklch(0.55 0.12 60)' },
    { key: 'APPROVED',    label: 'Утверждено',        color: 'oklch(0.45 0.1 145)' },
    { key: 'SIGNED',      label: 'Подписано',         color: 'oklch(0.32 0.08 155)' },
  ]
  async function handleDownload() {
    const res = await fetch(`/api/versions/${ver.id}/download`)
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.title}_v${ver.number}.docx`
    a.click()
    URL.revokeObjectURL(url)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[32px] z-50 rounded-[var(--radius-md)] py-[4px] min-w-[200px]"
          style={{ background: 'white', border: '1px solid var(--line)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Открыть / Скачать */}
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
            onClick={() => { router.push(`/documents/${doc.id}/work?version=${ver.id}`); setOpen(false) }}
          >
            Открыть в редакторе
          </button>
          {Boolean(ver.content) && (
            <button
              className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer flex items-center gap-[6px]"
              onClick={handleDownload}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Скачать DOCX
            </button>
          )}

          {/* Смена статуса (SIGNED — через модалку подписания) */}
          <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
          <p className="px-[14px] py-[4px] text-[10px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em]">Сменить статус</p>
          {ALL_STATUSES.filter((s) => s.key !== ver.status).map((s) => (
            <button
              key={s.key}
              className="w-full text-left px-[14px] py-[7px] text-[13px] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
              style={{ color: s.color }}
              onClick={() => {
                if (s.key === 'SIGNED') { onSign(ver); setOpen(false) }
                else { onStatusChange(ver.id, s.key); setOpen(false) }
              }}
            >
              → {s.label}
            </button>
          ))}

          {/* Удалить версию */}
          <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
          <button
            className="w-full text-left px-[14px] py-[8px] text-[13px] hover:bg-[oklch(0.97_0.015_20)] transition-colors cursor-pointer flex items-center gap-[8px]"
            style={{ color: 'oklch(0.5 0.15 20)' }}
            onClick={() => { setOpen(false); onDeleted(ver.id) }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Удалить версию
          </button>

          {/* Удалить документ */}
          {onDeleteDocument && (
            <>
              <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
              <button
                className="w-full text-left px-[14px] py-[8px] text-[13px] hover:bg-[oklch(0.97_0.015_20)] transition-colors cursor-pointer flex items-center gap-[8px]"
                style={{ color: 'oklch(0.5 0.15 20)' }}
                onClick={() => { setOpen(false); onDeleteDocument() }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                Удалить документ
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Компонент строки версии ──────────────────────────────────────────────────

function VersionRow({
  ver, isCurrent, doc, onStatusChange, onDeleted, onSign, onDeleteDocument,
}: {
  ver: Version; isCurrent: boolean; doc: Document
  onStatusChange: (verId: string, status: string) => void
  onDeleted: (verId: string) => void
  onSign: (ver: Version) => void
  onDeleteDocument?: () => void
}) {
  const router = useRouter()

  return (
    <div className={['px-[20px] py-[14px] border-b border-[var(--line)] last:border-0', isCurrent ? 'bg-[var(--surface-inset)]' : ''].join(' ')}>
      <div className="flex items-start gap-[12px]">
        <div className="shrink-0 w-[44px]">
          <p className="text-[12px] font-medium text-[var(--ink-4)]" style={{ fontFamily:'var(--font-mono)' }}>v.{ver.number}</p>
          {isCurrent && <p className="text-[10px] text-[var(--ink-4)] uppercase tracking-[0.06em]">Текущая</p>}
        </div>

        <div className="flex-1 min-w-0">
          {ver.aiSettings?.description ? (
            <p className="text-[13px] text-[var(--ink)] mb-[2px] line-clamp-2">{ver.aiSettings.description}</p>
          ) : (
            <p className="text-[13px] text-[var(--ink-3)] mb-[2px] italic">Черновик без описания</p>
          )}
          <p className="text-[12px] text-[var(--ink-4)]">{relDate(ver.createdAt)}</p>
        </div>

        <div className="flex items-center gap-[8px] shrink-0">
          <StatusBadge status={STATUS_MAP[ver.status] ?? 'draft'} />

          <button
            onClick={() => router.push(`/documents/${doc.id}/work?version=${ver.id}`)}
            className="h-[28px] px-[10px] text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
          >
            Открыть
          </button>

          <VersionMenu ver={ver} doc={doc} onStatusChange={onStatusChange} onDeleted={onDeleted} onSign={onSign} onDeleteDocument={onDeleteDocument} />
        </div>
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [doc, setDoc] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingVer, setSigningVer] = useState<Version | null>(null)
  const [signing, setSigning] = useState(false)
  const [sortAsc, setSortAsc] = useState(false) // false = по убыванию (новые сначала)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void; confirmLabel?: string; danger?: boolean } | null>(null)
  const [uploadingVersion, setUploadingVersion] = useState(false)
  const revisedFileInputRef = useRef<HTMLInputElement>(null)

  // Публичная ссылка «показать контрагенту»: создаём (или переиспользуем)
  // токен последней версии и копируем ссылку в буфер обмена.
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  async function handleShare() {
    const ver = doc?.versions[0]
    if (!ver) return
    try {
      const res = await fetch(`/api/versions/${ver.id}/share`, { method: 'POST' })
      if (!res.ok) throw new Error()
      const { token } = await res.json() as { token: string }
      const url = `${window.location.origin}/share/${token}`
      await navigator.clipboard.writeText(url)
      setShareMsg('Ссылка скопирована — отправьте её контрагенту. Доступ только на чтение.')
    } catch {
      setShareMsg('Не удалось создать ссылку. Попробуйте ещё раз.')
    }
    setTimeout(() => setShareMsg(null), 6000)
  }

  async function loadDoc() {
    const res = await fetch(`/api/documents/${id}`)
    if (res.ok) setDoc(await res.json())
    else router.push('/documents')
  }

  useEffect(() => {
    loadDoc().finally(() => setLoading(false))
  }, [id])

  async function handleSign(number: string, date: string) {
    if (!signingVer) return
    setSigning(true)
    try {
      const res = await fetch(`/api/versions/${signingVer.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SIGNED', signedAt: date, number: number || undefined }),
      })
      if (!res.ok) {
        showToast('Ошибка при подписании. Попробуйте ещё раз.', 'error')
        return
      }
      showToast('Договор подписан!', 'success')
      setSigningVer(null)
      await loadDoc()
    } finally {
      setSigning(false)
    }
  }

  async function handleVersionStatusChange(verId: string, status: string) {
    await fetch(`/api/versions/${verId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await loadDoc()
  }

  function handleVersionDeleted(verId: string) {
    const isPaid = !!doc?.versions.find((v) => v.id === verId)?.purchase
    setConfirmDialog({
      title: isPaid ? 'Удалить оплаченную версию?' : 'Удалить версию?',
      message: isPaid
        ? 'Это оплаченная версия — списанные средства не возвращаются, но запись об оплате останется в истории платежей. Восстановить версию будет нельзя.'
        : 'Версия будет удалена без возможности восстановления.',
      onConfirm: async () => {
        setConfirmDialog(null)
        const res = await fetch(`/api/versions/${verId}`, { method: 'DELETE' })
        if (!res.ok) { showToast('Не удалось удалить версию.', 'error'); return }
        await loadDoc()
      },
    })
  }

  function handleDeleteDocument() {
    const isPaid = !!doc?.versions.some((v) => v.purchase)
    const childCount = doc?.childDocuments.length ?? 0
    const message = [
      isPaid
        ? 'Это оплаченный документ — списанные средства не возвращаются, но запись об оплате останется в истории платежей.'
        : `Документ «${doc?.title}» и все его версии будут удалены.`,
      childCount > 0 ? `Вместе с ним удалятся ${childCount} ${childCount === 1 ? 'связанный документ' : childCount < 5 ? 'связанных документа' : 'связанных документов'} (приложения, допсоглашения).` : null,
      'Восстановить будет нельзя.',
    ].filter(Boolean).join(' ')
    setConfirmDialog({
      title: isPaid ? 'Удалить оплаченный документ?' : 'Удалить документ?',
      message,
      onConfirm: async () => {
        setConfirmDialog(null)
        const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
        if (!res.ok) { showToast('Не удалось удалить документ.', 'error'); return }
        router.push('/documents')
        router.refresh()
      },
    })
  }

  // Загрузка Word с правками контрагента как новой версии (append-only).
  // Сначала показываем предупреждение принять правки и убрать комментарии.
  function handleUploadRevisedVersion() {
    setConfirmDialog({
      title: 'Загрузить версию с правками',
      message: 'Загрузите файл Word (.docx) с правками от контрагента — он станет следующей версией документа, которую можно открыть в Догодок-чате. ВАЖНО: перед загрузкой откройте файл в Word и (1) примите все исправления (Рецензирование → Принять → Принять все исправления), (2) удалите все комментарии. Иначе правки и комментарии могут исказить распознавание текста.',
      confirmLabel: 'Выбрать файл',
      danger: false,
      onConfirm: () => {
        setConfirmDialog(null)
        revisedFileInputRef.current?.click()
      },
    })
  }

  async function handleRevisedFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // чтобы повторный выбор того же файла тоже срабатывал
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'docx' && ext !== 'doc') {
      showToast('Загрузите файл Word в формате .docx', 'error')
      return
    }

    setUploadingVersion(true)
    try {
      const content = await parseDocxToHtml(file)
      if (!content || !content.replace(/<[^>]*>/g, '').trim()) {
        showToast('Не удалось распознать текст в файле', 'error')
        return
      }

      // Переносим AI-настройки с текущей версии, чтобы продолжить работу с теми же параметрами
      const prev = currentVersion?.aiSettings ?? {}
      const res = await fetch(`/api/documents/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiSettings: {
            protectionLevel: prev.protectionLevel ?? 65,
            targetSize: prev.targetSize ?? 8400,
            customInstruction: prev.customInstruction ?? '',
            base: 'upload',
            description: 'Загружено из Word — правки контрагента',
          },
          content,
          status: 'DRAFT',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error ?? 'Не удалось загрузить версию', 'error')
        return
      }
      const newVersion = await res.json()
      showToast('Версия с правками загружена', 'success')
      await loadDoc()
      // Сразу открываем новую версию в ИИ-чате для дальнейшего редактирования
      router.push(`/documents/${id}/work?version=${newVersion.id}`)
    } catch {
      showToast('Ошибка при чтении файла Word', 'error')
    } finally {
      setUploadingVersion(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-[1080px]">
        <div className="mb-[20px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <div className="h-[14px] w-[60px] rounded bg-[var(--surface-inset)] animate-pulse" />
          </div>
          <div className="h-[32px] w-[55%] rounded bg-[var(--surface-inset)] animate-pulse mb-[8px]" />
          <div className="h-[14px] w-[30%] rounded bg-[var(--surface-inset)] animate-pulse" />
        </div>
        <div className="grid grid-cols-[1fr_300px] gap-[16px]">
          <div className="h-[400px] rounded-[var(--radius-lg)] bg-[var(--surface-inset)] animate-pulse" />
          <div className="h-[400px] rounded-[var(--radius-lg)] bg-[var(--surface-inset)] animate-pulse" />
        </div>
      </div>
    )
  }

  if (!doc) return null

  const currentVersion = doc.versions[0]
  const aiS = currentVersion?.aiSettings ?? {}
  // Документ ещё не сгенерирован через ИИ (создан, но текста нет) — действия,
  // которым нужен готовый текст (сравнение, проверка рисков, приложение к договору),
  // должны быть недоступны, пока пользователь не сгенерирует документ в ИИ-чате.
  const hasContent = Boolean(currentVersion?.content)

  return (
    <>
      {signingVer && doc && (
        <SignModal
          ver={signingVer}
          docId={doc.id}
          docTitle={doc.title}
          docNumber={doc.number}
          profileId={doc.profile?.id ?? null}
          onConfirm={handleSign}
          onClose={() => setSigningVer(null)}
          loading={signing}
        />
      )}

      <div className="max-w-[1080px]">
        {/* Заголовок */}
        <div className="mb-[20px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className="text-[12px] text-[var(--ink-4)]">{TYPE_LABELS[doc.type] ?? doc.type}</span>
            {doc.number && <span className="text-[12px] text-[var(--ink-4)]">· № {doc.number}</span>}
            {currentVersion && <StatusBadge status={STATUS_MAP[currentVersion.status] ?? 'draft'} />}
          </div>
          {/* Ссылка на родительский договор (для APPENDIX/AMENDMENT) */}
          {doc.parentDocument && (
            <div className="flex items-center gap-[6px] mb-[8px]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
              <span className="text-[12px] text-[var(--ink-4)]">
                {doc.documentNumber ? `№ ${doc.documentNumber} к ` : ''}
              </span>
              <button
                onClick={() => router.push(`/documents/${doc.parentDocument!.id}`)}
                className="text-[12px] text-[var(--accent-ink)] hover:underline cursor-pointer"
              >
                {doc.parentDocument.title}{doc.parentDocument.number ? ` № ${doc.parentDocument.number}` : ''}
              </button>
            </div>
          )}
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:400, lineHeight:1.2 }}>
            {doc.title}
          </h2>
          <p className="text-[13px] text-[var(--ink-3)] mt-[6px]">
            <span className="text-[var(--ink-2)] font-medium">{doc.counterparty.name}</span>
            {currentVersion && ` · текущая версия v.${currentVersion.number} · обновлена ${relDate(doc.updatedAt)}`}
          </p>
        </div>

        <div className="grid grid-cols-[1fr_260px] gap-[20px]">
          {/* Левая колонка — история версий */}
          <div>
            <div className="flex items-center justify-between mb-[12px]">
              <p className="text-[13px] font-medium text-[var(--ink)]">История версий</p>
              <div className="flex items-center gap-[8px]">
                {/* Сортировка */}
                <button
                  onClick={() => setSortAsc((v) => !v)}
                  className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
                  title={sortAsc ? 'Старые сначала' : 'Новые сначала'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {sortAsc ? <><line x1="12" y1="20" x2="12" y2="10"/><polyline points="18 14 12 20 6 14"/><line x1="12" y1="4" x2="12" y2="4"/></> : <><line x1="12" y1="4" x2="12" y2="14"/><polyline points="18 10 12 4 6 10"/><line x1="12" y1="20" x2="12" y2="20"/></>}
                  </svg>
                  {sortAsc ? 'v.1 → v.N' : 'v.N → v.1'}
                </button>
              </div>
            </div>

            <Card pad={false}>
              {doc.versions.length === 0 ? (
                <div className="py-[40px] text-center">
                  <p className="text-[13px] text-[var(--ink-4)]">Версий пока нет</p>
                </div>
              ) : (
                [...doc.versions]
                  .sort((a, b) => sortAsc ? a.number - b.number : b.number - a.number)
                  .map((ver) => (
                    <VersionRow
                      key={ver.id}
                      ver={ver}
                      isCurrent={ver.id === doc.versions[0]?.id}
                      doc={doc}
                      onStatusChange={handleVersionStatusChange}
                      onDeleted={handleVersionDeleted}
                      onSign={setSigningVer}
                      onDeleteDocument={handleDeleteDocument}
                    />
                  ))
              )}
            </Card>
          </div>

          {/* Правая колонка */}
          <div className="flex flex-col gap-[12px]">
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Быстрые действия</p>
              <div className="flex flex-col gap-[6px]">
                {[
                  { icon: '✦', label: 'Открыть в Догодок-чате', primary: true, onClick: () => router.push(`/documents/${id}/work`) },
                  { icon: '⇄', label: 'Сравнить', primary: false, disabled: !hasContent, disabledHint: 'Сначала сгенерируйте документ через Догодок-чат', onClick: () => router.push(`/documents/${id}/compare`) },
                  { icon: '◎', label: 'Проверить риски', primary: false, disabled: !hasContent, disabledHint: 'Сначала сгенерируйте документ через Догодок-чат', onClick: () => router.push(`/documents/${id}/check`) },
                  { icon: '↑', label: uploadingVersion ? 'Загрузка версии…' : 'Загрузить версию с правками', primary: false, disabled: uploadingVersion, onClick: handleUploadRevisedVersion },
                  { icon: '🔗', label: 'Показать контрагенту', primary: false, disabled: !hasContent, disabledHint: 'Сначала сгенерируйте документ через Догодок-чат', onClick: handleShare },
                  ...(hasContent ? [
                    { icon: '↓', label: 'Скачать версию', primary: false, onClick: async () => {
                      const res = await fetch(`/api/versions/${currentVersion.id}/download`)
                      if (!res.ok) return
                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url; a.download = `${doc.title}_v${currentVersion.number}.docx`; a.click()
                      URL.revokeObjectURL(url)
                    }},
                  ] : []),
                  // Для CONTRACT — добавить приложение или ДС
                  ...(doc.type === 'CONTRACT' ? [
                    { icon: '+', label: 'Создать приложение', primary: false, disabled: !hasContent, disabledHint: 'Сначала сгенерируйте документ через Догодок-чат', onClick: () => router.push(`/documents/new?parentDocumentId=${id}&type=APPENDIX`) },
                  ] : []),
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={action.disabled ? undefined : action.onClick}
                    disabled={action.disabled}
                    title={action.disabled ? action.disabledHint : undefined}
                    className={['w-full text-left px-[12px] py-[9px] rounded-[var(--radius-md)] text-[13px] font-medium transition-colors flex items-center gap-[8px]',
                      action.disabled
                        ? 'bg-[var(--surface-inset)] text-[var(--ink-4)] opacity-50 cursor-not-allowed'
                        : action.primary
                          ? 'bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 cursor-pointer'
                          : (action as { danger?: boolean }).danger
                            ? 'bg-[oklch(0.97_0.015_20)] text-[var(--danger)] hover:bg-[oklch(0.94_0.02_20)] cursor-pointer'
                            : 'bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer',
                    ].join(' ')}>
                    <span className="text-[14px]">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </Card>

            {/* Вложенные документы (для CONTRACT) */}
            {doc.type === 'CONTRACT' && doc.childDocuments.length > 0 && (
              <Card>
                <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Приложения и ДС к договору</p>
                <div className="flex flex-col gap-[4px]">
                  {doc.childDocuments.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => router.push(`/documents/${child.id}`)}
                      className="flex items-center gap-[8px] px-[8px] py-[7px] rounded-[var(--radius-md)] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer text-left w-full"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[var(--ink)] truncate">{child.title}</p>
                        <p className="text-[10px] text-[var(--ink-4)]">
                          {TYPE_LABELS[child.type] ?? child.type}
                          {child.documentNumber ? ` № ${child.documentNumber}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Параметры документа</p>
              <div className="flex flex-col gap-[8px] text-[13px]">
                {[
                  { label: 'Тип', value: TYPE_LABELS[doc.type] ?? doc.type },
                  { label: 'Контрагент', value: doc.counterparty.name },
                  ...(doc.number ? [{ label: 'Номер', value: doc.number }] : []),
                  { label: 'Дата', value: new Date(doc.createdAt).toLocaleDateString('ru', { day:'numeric', month:'long', year:'numeric' }) },
                  ...(aiS.protectionLevel !== undefined ? [{ label: 'Защищённость', value: `${aiS.protectionLevel}%` }] : []),
                  ...(aiS.targetSize ? [{ label: 'Объём', value: `~ ${Number(aiS.targetSize).toLocaleString('ru')} знаков` }] : []),
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-[8px]">
                    <p className="text-[var(--ink-4)] shrink-0">{row.label}</p>
                    <p className="text-[var(--ink-2)] text-right">{row.value}</p>
                  </div>
                ))}
              </div>
            </Card>

            <ExpiryCard doc={doc} onSaved={loadDoc} />

            {doc.counterparty.signatories.length > 0 && (
              <Card>
                <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Подписант</p>
                <div className="flex items-center gap-[8px]">
                  <Avatar name={doc.counterparty.signatories[0].fullName} size={28} />
                  <div>
                    <p className="text-[12px] font-medium">{doc.counterparty.signatories[0].fullName}</p>
                    <p className="text-[11px] text-[var(--ink-4)]">{doc.counterparty.signatories[0].position}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {shareMsg && (
        <div className="fixed bottom-[24px] right-[24px] z-40 max-w-[360px] rounded-[var(--radius-lg)] shadow-lg"
          style={{ background: 'var(--ink)', color: 'var(--bg)', padding: '12px 16px' }}>
          <span className="text-[13px] font-medium">{shareMsg}</span>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        danger={confirmDialog?.danger}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Скрытый input для загрузки Word с правками контрагента как новой версии */}
      <input
        ref={revisedFileInputRef}
        type="file"
        accept=".docx,.doc"
        className="hidden"
        onChange={handleRevisedFileSelected}
      />
    </>
  )
}
