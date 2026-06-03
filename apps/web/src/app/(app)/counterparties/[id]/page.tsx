'use client'

import { useState, useEffect, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Input } from '@/components/ui/input'
import { SignatoryModal, SignatoryData } from '@/components/counterparties/signatory-modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { validateInn, validateBik, validateCheckingAccount } from '@/lib/validation'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface BankDetail { id: string; bankName: string; checkingAccount: string; bik: string; correspondentAccount: string }
interface SignatoryScope { scope: string }
interface Signatory { id: string; fullName: string; signatureName: string; position: string; basisType: string; poaNumber: string | null; poaDate: string | null; poaExpiry: string | null; scopes: SignatoryScope[] }
interface Version { id: string; number: number; status: string; createdAt: string; purchase: { id: string } | null }
interface Document { id: string; title: string; type: string; createdAt: string; versions: Version[] }

interface ContactPerson { role: string; email: string; phone: string }

interface Counterparty {
  id: string; name: string; inn: string | null; kpp: string | null; ogrn: string | null
  legalAddress: string | null; email: string | null; phone: string | null
  contacts: ContactPerson[] | null
  isArchived: boolean; createdAt: string; updatedAt: string
  bankDetails: BankDetail[]; signatories: Signatory[]; documents: Document[]
}

const STATUS_MAP: Record<string, 'draft' | 'progress' | 'review' | 'approved' | 'paid' | 'signed'> = {
  DRAFT: 'draft', IN_PROGRESS: 'progress', REVIEW: 'review', APPROVED: 'approved', PAID: 'paid', SIGNED: 'signed',
}

const TYPE_LABELS: Record<string, string> = {
  CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'ДС',
}

const BASIS_LABELS: Record<string, string> = {
  CHARTER: 'Устав', POA: 'Доверенность', CERTIFICATE: 'Свидетельство', REGULATION: 'Положение', OTHER: 'Иное',
}

function relativeDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

// ─── Вкладка: Документы ───────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик', IN_PROGRESS: 'В работе', REVIEW: 'На проверке',
  APPROVED: 'Утверждено', PAID: 'Оплачено', SIGNED: 'Подписано',
}

function isClosedVersion(ver: Version) {
  return ver.purchase || ver.status === 'PAID' || ver.status === 'SIGNED'
}

function DocumentsTab({ cp }: { cp: Counterparty }) {
  const router = useRouter()

  // Только документы с хотя бы одной оплаченной/подписанной версией
  const visibleDocs = cp.documents
    .map((doc) => ({ ...doc, versions: doc.versions.filter(isClosedVersion) }))
    .filter((doc) => doc.versions.length > 0)

  return (
    <div className="flex flex-col gap-[16px]">
      {visibleDocs.length === 0 ? (
        <Card pad={false}>
          <div className="py-[60px] text-center">
            <p className="text-[14px] font-medium text-[var(--ink-2)] mb-[8px]">Оплаченных документов нет</p>
            <p className="text-[13px] text-[var(--ink-4)]">Оплаченные и подписанные версии появятся здесь</p>
          </div>
        </Card>
      ) : (
        <Card pad={false}>
          {visibleDocs.map((doc, i) => (
            <div key={doc.id}>
              {/* Заголовок документа — кликабельный */}
              <div
                onClick={() => router.push(`/documents/${doc.id}`)}
                className={[
                  'px-[16px] py-[12px] flex items-center gap-[10px] cursor-pointer hover:bg-[var(--surface-inset)] transition-colors',
                  i > 0 ? 'border-t border-[var(--line)]' : '',
                ].join(' ')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--ink)] truncate">{doc.title}</p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--ink-4)]">{TYPE_LABELS[doc.type] ?? doc.type}</span>
                <span className="shrink-0 text-[11px] text-[var(--ink-4)]">{relativeDate(doc.createdAt)}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>

              {/* Версии */}
              {doc.versions.map((ver) => (
                <div
                  key={ver.id}
                  onClick={() => router.push(`/documents/${doc.id}/work?version=${ver.id}`)}
                  className="flex items-center gap-[12px] px-[16px] py-[10px] pl-[42px] border-t border-[var(--line)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                >
                  <span className="text-[12px] text-[var(--ink-4)] shrink-0 w-[32px]" style={{ fontFamily: 'var(--font-mono)' }}>v.{ver.number}</span>
                  <span className="flex-1 text-[12px] text-[var(--ink-3)]">{relativeDate(ver.createdAt)}</span>
                  <Badge variant={ver.purchase ? 'paid' : (STATUS_MAP[ver.status] ?? 'draft')}>
                    {ver.purchase && ver.status !== 'SIGNED' ? 'Оплачено' : STATUS_LABELS[ver.status] ?? ver.status}
                  </Badge>
                  {ver.purchase && (
                    <button
                      className="shrink-0 w-[28px] h-[28px] flex items-center justify-center text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors"
                      title="Скачать"
                      onClick={(e) => {
                        e.stopPropagation()
                        fetch(`/api/versions/${ver.id}/download`).then(async (r) => {
                          if (!r.ok) return
                          const blob = await r.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url; a.download = `${doc.title}_v${ver.number}.docx`; a.click()
                          URL.revokeObjectURL(url)
                        })
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

// ─── Вкладка: Реквизиты ───────────────────────────────────────────────────────

function RequisitesTab({ cp, onRefresh }: { cp: Counterparty; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSignatory, setEditingSignatory] = useState<Signatory | null>(null)
  const [deleteSignatoryId, setDeleteSignatoryId] = useState<string | null>(null)

  const emptyContact = (): ContactPerson => ({ role: '', email: '', phone: '' })

  // Форма редактирования
  const [form, setForm] = useState({
    name: cp.name, inn: cp.inn ?? '', kpp: cp.kpp ?? '', ogrn: cp.ogrn ?? '',
    legalAddress: cp.legalAddress ?? '', email: cp.email ?? '', phone: cp.phone ?? '',
    bankName: cp.bankDetails[0]?.bankName ?? '', checkingAccount: cp.bankDetails[0]?.checkingAccount ?? '',
    bik: cp.bankDetails[0]?.bik ?? '', correspondentAccount: cp.bankDetails[0]?.correspondentAccount ?? '',
    contacts: (cp.contacts && cp.contacts.length > 0 ? cp.contacts : [emptyContact()]) as ContactPerson[],
  })

  const innError = form.inn ? validateInn(form.inn) : null
  const bikError = form.bik ? validateBik(form.bik) : null
  const accountError = form.checkingAccount ? validateCheckingAccount(form.checkingAccount, form.bik) : null

  const handleSave = async () => {
    setSaving(true)
    // Фильтруем пустые контакты перед сохранением
    const contacts = form.contacts.filter(c => c.role || c.email || c.phone)
    await fetch(`/api/counterparties/${cp.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, contacts }),
    })
    setSaving(false)
    setEditing(false)
    onRefresh()
  }

  const handleSaveSignatory = async (data: SignatoryData) => {
    if (editingSignatory) {
      await fetch(`/api/counterparties/${cp.id}/signatories/${editingSignatory.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
    } else {
      await fetch(`/api/counterparties/${cp.id}/signatories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
    }
    onRefresh()
  }

  const handleDeleteSignatory = (sid: string) => {
    setDeleteSignatoryId(sid)
  }

  const confirmDeleteSignatory = async () => {
    if (!deleteSignatoryId) return
    await fetch(`/api/counterparties/${cp.id}/signatories/${deleteSignatoryId}`, { method: 'DELETE' })
    setDeleteSignatoryId(null)
    onRefresh()
  }

  return (
    <div className="grid grid-cols-[1fr_260px] gap-[16px]">
      <ConfirmDialog
        open={!!deleteSignatoryId}
        title="Удалить подписанта?"
        message="Подписант будет удалён. Это действие нельзя отменить."
        confirmLabel="Удалить"
        onConfirm={confirmDeleteSignatory}
        onCancel={() => setDeleteSignatoryId(null)}
      />
      {/* Левая колонка — реквизиты */}
      <div className="flex flex-col gap-[12px]">

        {/* Организация */}
        <Card>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[8px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01"/>
              </svg>
              <p className="text-[13px] font-medium">Организация</p>
              <p className="text-[11px] text-[var(--ink-4)]">Подставляется в карточку договора</p>
            </div>
            {!editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Редактировать</Button>}
          </div>

          {editing ? (
            <div className="flex flex-col gap-[10px]">
              <Field label="Полное наименование"><Input value={form.name} onChange={(e) => setForm(p => ({...p, name: e.target.value}))} /></Field>
              <div className="grid grid-cols-2 gap-[10px]">
                <Field label="ИНН"><Input value={form.inn} onChange={(e) => setForm(p => ({...p, inn: e.target.value.replace(/\D/g,'').slice(0,12)}))} error={innError ?? undefined} style={{fontFamily:'var(--font-mono)'}} /></Field>
                <Field label="КПП"><Input value={form.kpp} onChange={(e) => setForm(p => ({...p, kpp: e.target.value.replace(/\D/g,'').slice(0,9)}))} style={{fontFamily:'var(--font-mono)'}} /></Field>
              </div>
              <Field label="ОГРН"><Input value={form.ogrn} onChange={(e) => setForm(p => ({...p, ogrn: e.target.value.replace(/\D/g,'').slice(0,15)}))} style={{fontFamily:'var(--font-mono)'}} /></Field>
              <Field label="Юридический адрес"><Input value={form.legalAddress} onChange={(e) => setForm(p => ({...p, legalAddress: e.target.value}))} /></Field>
            </div>
          ) : (
            <div className="flex flex-col gap-[8px] text-[13px]">
              <p className="font-medium">{cp.name}</p>
              <div className="grid grid-cols-2 gap-[8px] text-[var(--ink-3)]">
                {cp.inn && <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em]">ИНН</p><p style={{fontFamily:'var(--font-mono)'}}>{cp.inn}</p></div>}
                {cp.kpp && <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em]">КПП</p><p style={{fontFamily:'var(--font-mono)'}}>{cp.kpp}</p></div>}
                {cp.ogrn && <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em]">ОГРН</p><p style={{fontFamily:'var(--font-mono)'}}>{cp.ogrn}</p></div>}
              </div>
              {cp.legalAddress && <p className="text-[var(--ink-3)]">{cp.legalAddress}</p>}
            </div>
          )}
        </Card>

        {/* Банк */}
        <Card>
          <div className="flex items-center gap-[8px] mb-[14px]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>
            </svg>
            <p className="text-[13px] font-medium">Банковские реквизиты</p>
            <p className="text-[11px] text-[var(--ink-4)]">Подставляются в подпись договора</p>
          </div>
          {editing ? (
            <div className="flex flex-col gap-[10px]">
              <Field label="Банк"><Input value={form.bankName} onChange={(e) => setForm(p => ({...p, bankName: e.target.value}))} /></Field>
              <div className="grid grid-cols-2 gap-[10px]">
                <Field label="Расчётный счёт"><Input value={form.checkingAccount} onChange={(e) => setForm(p => ({...p, checkingAccount: e.target.value.replace(/\D/g,'').slice(0,20)}))} error={accountError ?? undefined} style={{fontFamily:'var(--font-mono)'}} /></Field>
                <Field label="БИК"><Input value={form.bik} onChange={(e) => setForm(p => ({...p, bik: e.target.value.replace(/\D/g,'').slice(0,9)}))} error={bikError ?? undefined} style={{fontFamily:'var(--font-mono)'}} /></Field>
              </div>
              <Field label="Корр. счёт"><Input value={form.correspondentAccount} onChange={(e) => setForm(p => ({...p, correspondentAccount: e.target.value.replace(/\D/g,'').slice(0,20)}))} style={{fontFamily:'var(--font-mono)'}} /></Field>
            </div>
          ) : cp.bankDetails[0] ? (
            <div className="flex flex-col gap-[8px] text-[13px]">
              <p className="font-medium">{cp.bankDetails[0].bankName}</p>
              <div className="grid grid-cols-2 gap-[8px] text-[var(--ink-3)]">
                <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em]">Расчётный счёт</p><p style={{fontFamily:'var(--font-mono)'}}>{cp.bankDetails[0].checkingAccount}</p></div>
                <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em]">БИК</p><p style={{fontFamily:'var(--font-mono)'}}>{cp.bankDetails[0].bik}</p></div>
                {cp.bankDetails[0].correspondentAccount && <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em]">Корр. счёт</p><p style={{fontFamily:'var(--font-mono)'}}>{cp.bankDetails[0].correspondentAccount}</p></div>}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--ink-4)]">Банковские реквизиты не указаны</p>
          )}
        </Card>

        {/* Контакты */}
        <Card>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[8px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/>
              </svg>
              <p className="text-[13px] font-medium">Контакты</p>
              <p className="text-[11px] text-[var(--ink-4)]">Не попадают в текст договора</p>
            </div>
            {editing && form.contacts.length < 3 && (
              <button
                onClick={() => setForm(p => ({ ...p, contacts: [...p.contacts, emptyContact()] }))}
                className="text-[12px] text-[var(--accent)] hover:opacity-70 transition-opacity cursor-pointer flex items-center gap-[4px]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Добавить контакт
              </button>
            )}
          </div>

          {editing ? (
            <div className="flex flex-col gap-[14px]">
              {form.contacts.map((c, i) => (
                <div key={i} className="flex flex-col gap-[8px] pb-[14px]" style={i < form.contacts.length - 1 ? { borderBottom: '1px solid var(--line)' } : {}}>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-[var(--ink-3)] uppercase tracking-[0.06em]">Контакт {i + 1}</p>
                    {form.contacts.length > 1 && (
                      <button
                        onClick={() => setForm(p => ({ ...p, contacts: p.contacts.filter((_, idx) => idx !== i) }))}
                        className="text-[11px] text-[var(--ink-4)] hover:text-red-500 transition-colors cursor-pointer"
                      >Удалить</button>
                    )}
                  </div>
                  <Field label="Должность / роль">
                    <Input
                      value={c.role}
                      placeholder="Бухгалтер, Менеджер..."
                      onChange={(e) => setForm(p => ({ ...p, contacts: p.contacts.map((x, idx) => idx === i ? { ...x, role: e.target.value } : x) }))}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-[10px]">
                    <Field label="Email">
                      <Input
                        value={c.email}
                        onChange={(e) => setForm(p => ({ ...p, contacts: p.contacts.map((x, idx) => idx === i ? { ...x, email: e.target.value } : x) }))}
                      />
                    </Field>
                    <Field label="Телефон">
                      <Input
                        value={c.phone}
                        onChange={(e) => setForm(p => ({ ...p, contacts: p.contacts.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x) }))}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            (() => {
              const contacts = cp.contacts && cp.contacts.length > 0 ? cp.contacts : []
              const legacy = !cp.contacts && (cp.email || cp.phone) ? [{ role: '', email: cp.email ?? '', phone: cp.phone ?? '' }] : []
              const all = [...contacts, ...legacy]
              if (all.length === 0) return <p className="text-[13px] text-[var(--ink-4)]">Контакты не указаны</p>
              return (
                <div className="flex flex-col gap-[12px]">
                  {all.map((c, i) => (
                    <div key={i} className="flex flex-col gap-[4px]">
                      {c.role && <p className="text-[11px] font-medium text-[var(--ink-3)] uppercase tracking-[0.06em]">{c.role}</p>}
                      <div className="grid grid-cols-2 gap-[8px] text-[13px]">
                        {c.email && <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[2px]">Email</p><p className="text-[var(--ink-2)]">{c.email}</p></div>}
                        {c.phone && <div><p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[2px]">Телефон</p><p className="text-[var(--ink-2)]">{c.phone}</p></div>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()
          )}
        </Card>

        {/* Подписанты */}
        <Card>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[8px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <p className="text-[13px] font-medium">Подписанты</p>
              <p className="text-[11px] text-[var(--ink-4)]">Кто подписывает со стороны контрагента</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setEditingSignatory(null); setModalOpen(true) }}>+ Добавить</Button>
          </div>

          {cp.signatories.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-4)]">Подписантов пока нет</p>
          ) : (
            <div className="flex flex-col gap-[8px]">
              {cp.signatories.map((sig) => (
                <div key={sig.id} className="flex items-center gap-[10px] px-[12px] py-[10px] bg-[var(--surface-inset)] rounded-[var(--radius-md)]">
                  <Avatar name={sig.fullName} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium">{sig.fullName}</p>
                    <p className="text-[12px] text-[var(--ink-3)]">{sig.position} · {BASIS_LABELS[sig.basisType]}</p>
                  </div>
                  <button onClick={() => { setEditingSignatory(sig); setModalOpen(true) }} className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer transition-colors">Изм.</button>
                  <button onClick={() => handleDeleteSignatory(sig.id)} className="text-[12px] text-[var(--danger)] cursor-pointer hover:opacity-70 transition-opacity">×</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Кнопки редактирования */}
        {editing && (
          <div className="flex items-center justify-end gap-[12px] pt-[4px]">
            <Button variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>Сохранить изменения</Button>
          </div>
        )}
      </div>

      {/* Правая колонка — превью */}
      <div className="flex flex-col gap-[12px]">
        <Card>
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Готовность к документу</p>
          {[
            { label: 'Шапка договора', done: !!cp.name },
            { label: 'Порядок с реквизитами', done: !!(cp.inn && cp.legalAddress) },
            { label: 'Подписант по умолчанию', done: cp.signatories.length > 0 },
            { label: 'Скан печати', done: false },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-[8px] mb-[8px]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={item.done ? 'var(--ok)' : 'var(--line-2)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <p className={['text-[12px]', item.done ? 'text-[var(--ink-2)]' : 'text-[var(--ink-4)]'].join(' ')}>{item.label}</p>
            </div>
          ))}
        </Card>

        <Card>
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Как в документе</p>
          <div className="text-[11px] text-[var(--ink-2)] leading-[1.7]">
            <p className="text-[10px] text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[4px] font-medium">ЗАКАЗЧИК</p>
            <p className="font-medium">{cp.name}</p>
            {cp.inn && <p>ИНН {cp.inn}{cp.kpp ? ` / КПП ${cp.kpp}` : ''}</p>}
            {cp.legalAddress && <p>{cp.legalAddress}</p>}
            {cp.bankDetails[0] && (
              <>
                <p className="mt-[6px]">р/с {cp.bankDetails[0].checkingAccount}</p>
                <p>{cp.bankDetails[0].bankName}</p>
                <p>БИК {cp.bankDetails[0].bik}</p>
                {cp.bankDetails[0].correspondentAccount && <p>к/с {cp.bankDetails[0].correspondentAccount}</p>}
              </>
            )}
            {cp.signatories[0] && (
              <>
                <div className="border-t border-dashed border-[var(--line)] mt-[6px] pt-[6px]" />
                <p>{cp.signatories[0].position} {cp.signatories[0].signatureName}</p>
              </>
            )}
          </div>
        </Card>

        {cp.signatories.length > 1 && (
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Подписанты</p>
            <p className="text-[12px] text-[var(--ink-3)]">У контрагента несколько подписантов — нужного можно выбрать при создании версии документа в блоке «Параметры».</p>
          </Card>
        )}
      </div>

      {/* Модалка подписанта */}
      {modalOpen && (
        <SignatoryModal
          initial={editingSignatory ? {
            id: editingSignatory.id, fullName: editingSignatory.fullName,
            signatureName: editingSignatory.signatureName, position: editingSignatory.position,
            basisType: editingSignatory.basisType as SignatoryData['basisType'],
            poaNumber: editingSignatory.poaNumber ?? '', poaDate: editingSignatory.poaDate ?? '',
            poaExpiry: editingSignatory.poaExpiry ?? '', scopes: editingSignatory.scopes.map(s => s.scope),
          } : null}
          counterpartyName={cp.name}
          onSave={handleSaveSignatory}
          onClose={() => { setModalOpen(false); setEditingSignatory(null) }}
        />
      )}
    </div>
  )
}

// ─── Главный компонент страницы ───────────────────────────────────────────────

export default function CounterpartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') as string) || 'documents'

  const [cp, setCp] = useState<Counterparty | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/counterparties/${id}`)
    if (res.ok) setCp(await res.json())
    else router.push('/counterparties')
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 py-[120px]">
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (!cp) return null

  const totalVersions = cp.documents.reduce((s, d) => s + d.versions.length, 0)
  const totalPaid = cp.documents.reduce((s, d) => s + d.versions.filter(v => v.purchase).length, 0)

  const tabs = [
    { key: 'documents', label: 'Все документы', count: cp.documents.length },
    { key: 'requisites', label: 'Реквизиты' },
  ]

  const setTab = (key: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', key)
    router.push(url.pathname + url.search)
  }

  return (
    <div className="max-w-[1080px]">
      {/* Хедер карточки */}
      <Card className="mb-[20px]">
        <div className="flex items-start gap-[16px]">
          <Avatar name={cp.name} size={52} />
          <div className="flex-1 min-w-0">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, marginBottom: 4 }}>{cp.name}</h2>
            <div className="flex items-center gap-[16px] text-[13px] text-[var(--ink-4)]">
              {cp.inn && <span style={{ fontFamily: 'var(--font-mono)' }}>ИНН {cp.inn}</span>}
              {cp.kpp && <span style={{ fontFamily: 'var(--font-mono)' }}>{cp.kpp}</span>}
              <span>Контрагент с {new Date(cp.createdAt).toLocaleDateString('ru', { month: 'long', year: 'numeric' })}</span>
            </div>
          </div>
          <Button variant="primary">Новый документ</Button>
        </div>

        {/* Статистика */}
        <div className="grid grid-cols-4 gap-[12px] mt-[20px] pt-[16px] border-t border-[var(--line)]">
          {[
            { label: 'Документов', value: cp.documents.length, sub: `${cp.documents.filter(d => d.versions.some(v => v.status !== 'DRAFT')).length} активных` },
            { label: 'Версий', value: totalVersions, sub: `${cp.documents.reduce((s, d) => s + d.versions.filter(v => v.status === 'APPROVED' || v.status === 'PAID').length, 0)} утверждено` },
            { label: 'Оплачено за всё время', value: totalPaid > 0 ? `${totalPaid} вер.` : '—', sub: '' },
            { label: 'Последняя активность', value: relativeDate(cp.updatedAt), sub: `версия v.${cp.documents[0]?.versions[0]?.number ?? '—'}` },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[4px]">{s.label}</p>
              <p className="text-[18px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>{s.value}</p>
              {s.sub && <p className="text-[12px] text-[var(--ink-4)] mt-[2px]">{s.sub}</p>}
            </div>
          ))}
        </div>
      </Card>

      {/* Табы */}
      <div className="flex gap-0 border-b border-[var(--line)] mb-[16px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={['px-[16px] py-[10px] text-[14px] font-medium relative transition-colors cursor-pointer', activeTab === t.key ? 'text-[var(--ink)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]'].join(' ')}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-[6px] text-[12px] text-[var(--ink-4)]">{t.count}</span>
            )}
            {activeTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--ink)]" />}
          </button>
        ))}
      </div>

      {/* Содержимое вкладки */}
      {activeTab === 'documents' && <DocumentsTab cp={cp} />}
      {activeTab === 'requisites' && <RequisitesTab cp={cp} onRefresh={load} />}
    </div>
  )
}
