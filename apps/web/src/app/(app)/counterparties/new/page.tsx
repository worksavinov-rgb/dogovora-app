'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { SignatoryModal, SignatoryData } from '@/components/counterparties/signatory-modal'
import { validateInn, validateBik, validateCheckingAccount, validatePassportSeries, validatePassportNumber, validatePassportDeptCode } from '@/lib/validation'
import { Avatar } from '@/components/ui/avatar'
import { RequisitesPreview, type RequisitesData } from '@/components/requisites-preview'

type CpType = 'INDIVIDUAL' | 'SELF_EMPLOYED' | 'SOLE_PROPRIETOR' | 'COMPANY' | 'ANO' | 'PAO' | 'ZAO'

const TYPE_LABELS: Record<CpType, string> = {
  SOLE_PROPRIETOR: 'ИП',
  COMPANY: 'ООО/АО',
  INDIVIDUAL: 'Физлицо',
  SELF_EMPLOYED: 'Самозанятый',
  ANO: 'АНО',
  PAO: 'ПАО',
  ZAO: 'ЗАО',
}

interface FormData {
  type: CpType
  name: string
  inn: string
  kpp: string
  ogrn: string
  legalAddress: string
  actualAddress: string
  passportSeries: string
  passportNumber: string
  passportIssuedBy: string
  passportIssueDate: string
  passportDeptCode: string
  npdRegisteredDate: string
  email: string
  phone: string
  bankName: string
  checkingAccount: string
  bik: string
  correspondentAccount: string
}

const EMPTY: FormData = {
  type: 'COMPANY', name: '', inn: '', kpp: '', ogrn: '', legalAddress: '', actualAddress: '',
  passportSeries: '', passportNumber: '', passportIssuedBy: '', passportIssueDate: '',
  passportDeptCode: '', npdRegisteredDate: '',
  email: '', phone: '', bankName: '', checkingAccount: '', bik: '', correspondentAccount: '',
}

// Угадываем org-форму по ИНН (подсказка, тип не переключаем автоматически)
function guessForm(inn: string): string {
  if (inn.length === 10) return 'ООО'
  if (inn.length === 12) return 'ИП / физлицо'
  return ''
}

export default function NewCounterpartyPage() {
  const router = useRouter()
  const [form, setForm] = useState<FormData>(EMPTY)
  const [signatories, setSignatories] = useState<SignatoryData[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSignatory, setEditingSignatory] = useState<SignatoryData | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const set = (key: keyof FormData, val: string) => setForm((p) => ({ ...p, [key]: val }))
  const isPerson = form.type === 'INDIVIDUAL' || form.type === 'SELF_EMPLOYED'

  // Ошибки валидации (только если поле заполнено)
  const innError = form.inn ? validateInn(form.inn) : null
  const bikError = form.bik ? validateBik(form.bik) : null
  const accountError = form.checkingAccount ? validateCheckingAccount(form.checkingAccount, form.bik) : null
  const passSeriesError = form.passportSeries ? validatePassportSeries(form.passportSeries) : null
  const passNumError = form.passportNumber ? validatePassportNumber(form.passportNumber) : null
  const deptError = form.passportDeptCode ? validatePassportDeptCode(form.passportDeptCode) : null

  // Шаги прогресса
  const progress = [
    { label: 'ИНН', done: !!form.inn && !innError },
    { label: 'Название / ФИО', done: !!form.name },
    { label: isPerson ? 'Адрес регистрации' : 'Юридический адрес', done: !!form.legalAddress },
    { label: 'Банк', done: !!form.bankName },
    { label: 'Расч. счёт', done: !!form.checkingAccount && !accountError },
    isPerson
      ? { label: 'Паспорт', done: !!form.passportSeries && !passSeriesError }
      : { label: 'Подписант для договоров', done: signatories.length > 0 },
  ]

  const handleSave = async () => {
    if (!form.name.trim()) { setSaveError('Укажите название контрагента'); return }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/counterparties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        setSaveError(err.error ?? 'Ошибка сохранения')
        return
      }
      const cp = await res.json()
      // Сохраняем подписантов
      for (const sig of signatories) {
        await fetch(`/api/counterparties/${cp.id}/signatories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sig),
        })
      }
      router.push(`/counterparties/${cp.id}`)
    } finally {
      setSaving(false)
    }
  }

  const handleAddSignatory = async (data: SignatoryData) => {
    if (editingSignatory?.id !== undefined) {
      // Редактируем существующего
      setSignatories((prev) => prev.map((s) => s === editingSignatory ? data : s))
    } else {
      setSignatories((prev) => [...prev, data])
    }
    setEditingSignatory(null)
  }

  const openEdit = (sig: SignatoryData) => { setEditingSignatory(sig); setModalOpen(true) }
  const openNew = () => { setEditingSignatory(null); setModalOpen(true) }

  return (
    <div className="max-w-[1080px]">
      {/* Заголовок */}
      <div className="mb-[6px]">
        <p className="text-[12px] text-[var(--ink-4)] mb-[4px]">Шаг 1 — Основные данные</p>
        <h2 style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 400, marginBottom: 6 }}>Добавить контрагента</h2>
        <p className="text-[14px] text-[var(--ink-3)]">Введите ИНН — заполним основные поля автоматически по данным ФНС. Дальше — банк и подписанты.</p>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-[20px] mt-[24px]">
        {/* Левая колонка — форма */}
        <div className="flex flex-col gap-[12px]">

          {/* Организация */}
          <Card>
            <div className="flex items-center gap-[8px] mb-[16px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01"/>
              </svg>
              <p className="text-[13px] font-medium">{isPerson ? 'Сторона' : 'Организация'}</p>
              <p className="text-[12px] text-[var(--ink-4)]">Поля для вставки в договор</p>
            </div>
            <div className="flex flex-col gap-[12px]">
              {/* Тип контрагента */}
              <Field label="Тип">
                <div className="flex flex-wrap gap-[6px]">
                  {(['SOLE_PROPRIETOR', 'COMPANY', 'INDIVIDUAL', 'SELF_EMPLOYED', 'ANO', 'PAO', 'ZAO'] as CpType[]).map((t) => (
                    <button key={t} type="button" onClick={() => set('type', t)}
                      className={['px-[12px] h-[32px] rounded-[var(--radius-md)] text-[12px] font-medium border transition-colors cursor-pointer',
                        form.type === t ? 'border-[var(--ink)] bg-[var(--surface-inset)] text-[var(--ink)]' : 'border-[var(--line-2)] text-[var(--ink-3)] hover:border-[var(--line-strong)]',
                      ].join(' ')}>
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={isPerson ? 'ИНН (12 цифр, необязательно)' : 'ИНН организации или ИП'}>
                <Input
                  value={form.inn}
                  onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder="7727456789"
                  error={innError ?? undefined}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                {form.inn && !innError && !isPerson && (
                  <p className="mt-[4px] text-[12px] text-[var(--ok)]">
                    {guessForm(form.inn) ? `Определено: ${guessForm(form.inn)}` : ''}
                  </p>
                )}
              </Field>
              <Field label={isPerson ? 'ФИО' : 'Полное наименование'}>
                <Input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder={isPerson ? 'Иванов Иван Иванович' : 'Общество с ограниченной ответственностью «Сирень»'} />
              </Field>
              {!isPerson && (
                <div className="grid grid-cols-2 gap-[12px]">
                  <Field label="КПП">
                    <Input value={form.kpp} onChange={(e) => set('kpp', e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="772701001" style={{ fontFamily: 'var(--font-mono)' }} />
                  </Field>
                  <Field label="ОГРН">
                    <Input value={form.ogrn} onChange={(e) => set('ogrn', e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="1027746543218" style={{ fontFamily: 'var(--font-mono)' }} />
                  </Field>
                </div>
              )}
              <Field label={isPerson ? 'Адрес регистрации' : 'Юридический адрес'}>
                <Input value={form.legalAddress} onChange={(e) => set('legalAddress', e.target.value)} placeholder="117418, г. Москва, ул. Профсоюзная, д. 23, эт. 4, пом. 12" />
              </Field>

              {/* Паспорт физлица/самозанятого (все поля необязательны) */}
              {isPerson && (
                <>
                  <div className="grid grid-cols-2 gap-[12px]">
                    <Field label="Серия паспорта">
                      <Input value={form.passportSeries}
                        onChange={(e) => set('passportSeries', e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="1234" error={passSeriesError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                    </Field>
                    <Field label="Номер паспорта">
                      <Input value={form.passportNumber}
                        onChange={(e) => set('passportNumber', e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="567890" error={passNumError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                    </Field>
                  </div>
                  <Field label="Кем выдан">
                    <Input value={form.passportIssuedBy} onChange={(e) => set('passportIssuedBy', e.target.value)}
                      placeholder="Отделом УФМS России по г. Москве" />
                  </Field>
                  <div className="grid grid-cols-2 gap-[12px]">
                    <Field label="Дата выдачи">
                      <Input value={form.passportIssueDate} onChange={(e) => set('passportIssueDate', e.target.value)} placeholder="10.05.2015" />
                    </Field>
                    <Field label="Код подразделения">
                      <Input value={form.passportDeptCode}
                        onChange={(e) => set('passportDeptCode', e.target.value.replace(/[^\d-]/g, '').slice(0, 7))}
                        placeholder="770-053" error={deptError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                    </Field>
                  </div>
                  <Field label="Фактический адрес (если отличается)">
                    <Input value={form.actualAddress} onChange={(e) => set('actualAddress', e.target.value)}
                      placeholder="Если совпадает с адресом регистрации — оставьте пустым" />
                  </Field>
                  {form.type === 'SELF_EMPLOYED' && (
                    <Field label="Дата постановки на учёт по НПД (необязательно)">
                      <Input value={form.npdRegisteredDate} onChange={(e) => set('npdRegisteredDate', e.target.value)} placeholder="01.01.2024" />
                    </Field>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Банковские реквизиты */}
          <Card>
            <div className="flex items-center gap-[8px] mb-[16px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>
              </svg>
              <p className="text-[13px] font-medium">Банковские реквизиты</p>
              <p className="text-[12px] text-[var(--ink-4)]">Для подписи договора</p>
            </div>
            <div className="flex flex-col gap-[12px]">
              <Field label="Банк">
                <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="ПАО «Сбербанк России»" />
              </Field>
              <div className="grid grid-cols-2 gap-[12px]">
                <Field label="Расчётный счёт">
                  <Input value={form.checkingAccount} onChange={(e) => set('checkingAccount', e.target.value.replace(/\D/g, '').slice(0, 20))} placeholder="40702 810 5 3800 0123456" error={accountError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                </Field>
                <Field label="БИК">
                  <Input value={form.bik} onChange={(e) => set('bik', e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="044525225" error={bikError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                </Field>
              </div>
              <Field label="Корреспондентский счёт">
                <Input value={form.correspondentAccount} onChange={(e) => set('correspondentAccount', e.target.value.replace(/\D/g, '').slice(0, 20))} placeholder="30101 810 4 0000 0000225" style={{ fontFamily: 'var(--font-mono)' }} />
              </Field>
            </div>
          </Card>

          {/* Контакты */}
          <Card>
            <div className="flex items-center gap-[8px] mb-[16px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/>
              </svg>
              <p className="text-[13px] font-medium">Контакты</p>
              <p className="text-[12px] text-[var(--ink-4)]">Не попадают в текст договора, нужны для уведомлений</p>
            </div>
            <div className="grid grid-cols-2 gap-[12px]">
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="contracts@siren.example" />
              </Field>
              <Field label="Телефон">
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+7 495 555-44-33" />
              </Field>
            </div>
          </Card>

          {/* Подписанты — только для организаций/ИП; физлицо/самозанятый подписывает лично */}
          {!isPerson && (
          <Card>
            <div className="flex items-center justify-between mb-[16px]">
              <div className="flex items-center gap-[8px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p className="text-[13px] font-medium">Подписанты</p>
                <p className="text-[12px] text-[var(--ink-4)]">Кто подписывает со стороны контрагента. Может быть несколько.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={openNew}>+ Ещё подписант</Button>
            </div>

            {signatories.length === 0 ? (
              <div className="py-[12px] text-center">
                <p className="text-[13px] text-[var(--ink-4)]">Подписантов пока нет — добавьте хотя бы одного</p>
              </div>
            ) : (
              <div className="flex flex-col gap-[8px]">
                {signatories.map((sig, i) => (
                  <div key={i} className="flex items-center gap-[12px] px-[14px] py-[10px] bg-[var(--surface-inset)] rounded-[var(--radius-md)]">
                    <Avatar name={sig.fullName} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--ink)]">{sig.fullName}</p>
                      <p className="text-[12px] text-[var(--ink-3)]">{sig.position}</p>
                    </div>
                    <button onClick={() => openEdit(sig)} className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer">Свернуть</button>
                    <button onClick={() => setSignatories((prev) => prev.filter((_, j) => j !== i))} className="text-[12px] text-[var(--danger)] hover:text-[var(--danger)] transition-colors cursor-pointer">×</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
          )}

          {/* Нижняя панель */}
          <div className="flex items-center justify-between pt-[4px]">
            <div>{saveError && <p className="text-[13px] text-[var(--danger)]">{saveError}</p>}</div>
            <div className="flex gap-[12px]">
              <Button variant="ghost" onClick={() => router.push('/counterparties')}>Отмена</Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>Сохранить контрагента</Button>
            </div>
          </div>
        </div>

        {/* Правая колонка — прогресс */}
        <div className="flex flex-col gap-[12px]">
          <Card>
            <p className="text-[12px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">Прогресс заполнения</p>
            <div className="flex flex-col gap-[8px]">
              {progress.map((step) => (
                <div key={step.label} className="flex items-center gap-[8px]">
                  <div className={['w-[16px] h-[16px] rounded-full border flex items-center justify-center shrink-0', step.done ? 'bg-[var(--ok)] border-[var(--ok)]' : 'border-[var(--line-2)]'].join(' ')}>
                    {step.done && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                  <p className={['text-[13px]', step.done ? 'text-[var(--ink)]' : 'text-[var(--ink-4)]'].join(' ')}>{step.label}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Превью «Как в документе» */}
          {form.name && (
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Как в документе</p>
              <RequisitesPreview
                data={{
                  type: form.type,
                  name: form.name,
                  inn: form.inn,
                  kpp: form.kpp,
                  ogrn: form.ogrn,
                  legalAddress: form.legalAddress,
                  actualAddress: form.actualAddress,
                  passportSeries: form.passportSeries,
                  passportNumber: form.passportNumber,
                  passportIssuedBy: form.passportIssuedBy,
                  passportIssueDate: form.passportIssueDate,
                  passportDeptCode: form.passportDeptCode,
                  npdRegisteredDate: form.npdRegisteredDate,
                  email: form.email,
                  signatorName: signatories[0]?.fullName ?? null,
                  signatorPosition: signatories[0]?.position ?? null,
                  bankName: form.bankName,
                  bik: form.bik,
                  checkingAccount: form.checkingAccount,
                  correspondentAccount: form.correspondentAccount,
                } satisfies RequisitesData}
              />
            </Card>
          )}
        </div>
      </div>

      {/* Модалка подписанта */}
      {modalOpen && (
        <SignatoryModal
          initial={editingSignatory}
          counterpartyName={form.name}
          onSave={handleAddSignatory}
          onClose={() => { setModalOpen(false); setEditingSignatory(null) }}
        />
      )}
    </div>
  )
}
