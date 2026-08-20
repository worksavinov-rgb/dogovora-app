'use client'

/**
 * Шаг «Оформление» перед скачиванием: выбор своей компании, подписанта
 * контрагента, города и даты + живой предпросмотр шапки и реквизитов.
 * Подтверждение сохраняет блоки на документ (POST /api/documents/:id/decor).
 */

import { useState, useEffect, useRef, useCallback } from 'react'

interface ProfileOption { id: string; name: string }
interface SignatoryOption { id: string; fullName: string; position: string; isDefault?: boolean }

interface DecorModalProps {
  documentId: string
  counterpartyId: string | null
  open: boolean
  onClose: () => void
  /** Вызывается после подтверждения (или выбора «без шапки») — качаем файл */
  onConfirmed: (opts?: { bare?: boolean }) => void
}

export function DecorModal({ documentId, counterpartyId, open, onClose, onConfirmed }: DecorModalProps) {
  const [profiles, setProfiles] = useState<ProfileOption[]>([])
  const [signatories, setSignatories] = useState<SignatoryOption[]>([])
  const [profileId, setProfileId] = useState('')
  const [signatoryId, setSignatoryId] = useState('')
  const [city, setCity] = useState('')
  const [signingDate, setSigningDate] = useState('')
  const [preview, setPreview] = useState<{ preambleHtml: string; requisitesHtml: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Загрузка справочников при открытии
  useEffect(() => {
    if (!open) return
    setError(null)
    fetch('/api/profiles')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProfileOption[]) => { if (Array.isArray(data)) setProfiles(data) })
      .catch(() => {})
    if (counterpartyId) {
      fetch(`/api/counterparties/${counterpartyId}/signatories`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: SignatoryOption[]) => {
          if (Array.isArray(data)) {
            setSignatories(data)
            const def = data.find((s) => s.isDefault) ?? data[0]
            setSignatoryId((prev) => prev || (def?.id ?? ''))
          }
        })
        .catch(() => {})
    }
    // Текущее состояние оформления (профиль/дата документа)
    fetch(`/api/documents/${documentId}/decor`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profileId?: string | null; signingDate?: string | null } | null) => {
        if (d?.profileId) setProfileId((prev) => prev || d.profileId!)
        if (d?.signingDate) setSigningDate((prev) => prev || d.signingDate!.slice(0, 10))
      })
      .catch(() => {})
  }, [open, documentId, counterpartyId])

  // Живой предпросмотр (с дебаунсом)
  const loadPreview = useCallback(() => {
    setPreviewLoading(true)
    fetch(`/api/documents/${documentId}/decor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preview: true,
        profileId: profileId || undefined,
        signatoryId: signatoryId || undefined,
        city: city || undefined,
        signingDate: signingDate || undefined,
      }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setError(d.error ?? 'Не удалось собрать оформление'); setPreview(null); return }
        setError(null)
        setPreview({ preambleHtml: d.preambleHtml, requisitesHtml: d.requisitesHtml })
      })
      .catch(() => setError('Не удалось собрать оформление'))
      .finally(() => setPreviewLoading(false))
  }, [documentId, profileId, signatoryId, city, signingDate])

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(loadPreview, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [open, loadPreview])

  async function confirm() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/documents/${documentId}/decor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: profileId || undefined,
          signatoryId: signatoryId || undefined,
          city: city || undefined,
          signingDate: signingDate || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Не удалось сохранить оформление')
        return
      }
      onConfirmed()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const selectCls = 'w-full h-[34px] px-[10px] rounded-[var(--radius-md)] border border-[var(--line-2)] bg-white text-[13px] text-[var(--ink)]'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative z-10 w-[720px] max-w-[94vw] max-h-[86vh] overflow-y-auto rounded-[var(--radius-xl)] p-[24px] flex flex-col gap-[16px]"
        style={{ background: 'var(--bg)', border: '1px solid var(--line)', boxShadow: '0 16px 40px rgba(0,0,0,0.14)' }}
      >
        <div>
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[6px]">Оформление документа</p>
          <p className="text-[13px] text-[var(--ink-3)] leading-[1.5]">
            Шапка и реквизиты подставятся из карточек и сохранятся на документе — их можно будет поправить прямо в предпросмотре.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-[12px]">
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] text-[var(--ink-4)]">Моя компания</span>
            <select className={selectCls} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">— по умолчанию —</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] text-[var(--ink-4)]">Подписант контрагента</span>
            <select className={selectCls} value={signatoryId} onChange={(e) => setSignatoryId(e.target.value)}>
              <option value="">— по умолчанию —</option>
              {signatories.map((s) => <option key={s.id} value={s.id}>{s.fullName} — {s.position}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] text-[var(--ink-4)]">Город</span>
            <input className={selectCls} placeholder="из адреса компании" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] text-[var(--ink-4)]">Дата подписания</span>
            <input type="date" className={selectCls} value={signingDate} onChange={(e) => setSigningDate(e.target.value)} />
          </label>
        </div>

        {error && (
          <div className="rounded-[var(--radius-md)] px-[12px] py-[10px]"
            style={{ background: 'oklch(0.96 0.025 20)', border: '1px solid oklch(0.88 0.04 20)' }}>
            <p className="text-[12px] text-[var(--danger)]">{error}</p>
          </div>
        )}

        {/* Живой предпросмотр. Класс document-viewer — тот же, что у листа на
            рабочем экране: реквизиты показываются в две колонки, как они и уйдут
            в Word. Раньше здесь стоял свой flex-col, и предпросмотр расходился
            и с экраном, и со скачанным файлом. */}
        <div className="document-viewer rounded-[var(--radius-md)] px-[16px] py-[14px] text-[12.5px] leading-[1.6] text-[var(--ink-2)]"
          style={{ background: 'white', border: '1px solid var(--line-2)', opacity: previewLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
          {preview ? (
            <>
              <div className="[&_p]:mb-[6px]" dangerouslySetInnerHTML={{ __html: preview.preambleHtml }} />
              <div className="my-[10px] text-center text-[11px] text-[var(--ink-4)]">· · · тело договора · · ·</div>
              <div dangerouslySetInnerHTML={{ __html: preview.requisitesHtml }} />
            </>
          ) : (
            <p className="text-[12px] text-[var(--ink-4)]">Собираю предпросмотр…</p>
          )}
        </div>

        <div className="flex items-center gap-[8px]">
          <button
            onClick={() => onConfirmed({ bare: true })}
            className="h-[38px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            Скачать без шапки
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="h-[38px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium text-[var(--ink-2)] bg-[var(--surface)] border border-[var(--line-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={saving || !preview}
            className="h-[38px] px-[16px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
          >
            {saving ? 'Сохраняю…' : 'Подтвердить и скачать'}
          </button>
        </div>
      </div>
    </div>
  )
}
