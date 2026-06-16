'use client'

import { useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { validateInn, validateOgrn, validateBik, validateCheckingAccount, validateKpp } from '@/lib/validation'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RequisitesPreview, type RequisitesData } from '@/components/requisites-preview'

// ─── Типы ─────────────────────────────────────────────────────────────────────

type ProfileType = 'SOLE_PROPRIETOR' | 'COMPANY' | 'INDIVIDUAL' | 'ANO' | 'PAO' | 'ZAO'

type ProfileFormData = {
  type: ProfileType; name: string; inn: string; kpp: string; ogrn: string; ogrnDate: string
  legalAddress: string; signatorName: string; signatorPosition: string; signatorBasis: string
  bankName: string; checkingAccount: string; bik: string; correspondentAccount: string
}

interface BankDetail {
  id?: string
  bankName: string
  checkingAccount: string
  bik: string
  correspondentAccount: string
}

interface Profile {
  id: string
  type: ProfileType
  name: string
  inn: string
  kpp: string
  ogrn: string
  ogrnDate: string
  legalAddress: string
  email: string
  signatorName: string
  signatorPosition: string
  signatorBasis: string
  signatureFilePath: string | null
  stampFilePath: string | null
  bankDetails: BankDetail[]
}

const TYPE_LABELS: Record<ProfileType, string> = {
  SOLE_PROPRIETOR: 'ИП',
  COMPANY: 'ООО/АО',
  INDIVIDUAL: 'Физлицо',
  ANO: 'АНО',
  PAO: 'ПАО',
  ZAO: 'ЗАО',
}

const TYPE_COLORS: Record<ProfileType, string> = {
  SOLE_PROPRIETOR: 'bg-[oklch(0.92_0.05_280)] text-[oklch(0.35_0.1_280)]',
  COMPANY: 'bg-[oklch(0.92_0.05_200)] text-[oklch(0.35_0.1_200)]',
  INDIVIDUAL: 'bg-[oklch(0.92_0.04_100)] text-[oklch(0.35_0.08_100)]',
  ANO: 'bg-[oklch(0.92_0.05_150)] text-[oklch(0.35_0.1_150)]',
  PAO: 'bg-[oklch(0.92_0.05_30)] text-[oklch(0.35_0.1_30)]',
  ZAO: 'bg-[oklch(0.92_0.04_320)] text-[oklch(0.35_0.08_320)]',
}

// Типы у которых есть КПП
const TYPE_HAS_KPP: Set<ProfileType> = new Set(['COMPANY', 'ANO', 'PAO', 'ZAO'])
// Типы у которых ИНН 10 цифр (юрлица)
const TYPE_INN_10: Set<ProfileType> = new Set(['COMPANY', 'ANO', 'PAO', 'ZAO'])

const EMPTY_BANK: BankDetail = { bankName: '', checkingAccount: '', bik: '', correspondentAccount: '' }

// Поля которые сбрасываются при смене типа (зависят от типа)
function clearTypeSpecificFields(profile: Omit<Profile, 'id'>, newType: ProfileType): Omit<Profile, 'id'> {
  const isLegalEntity = TYPE_HAS_KPP.has(newType)
  const wasLegalEntity = TYPE_HAS_KPP.has(profile.type)
  const innLenChanged = TYPE_INN_10.has(newType) !== TYPE_INN_10.has(profile.type)

  return {
    ...profile,
    type: newType,
    // КПП — только для юрлиц; если переходим на физлицо/ИП — очищаем
    kpp: isLegalEntity ? profile.kpp : '',
    // ОГРН меняет длину и формат при смене группы — сбрасываем
    ogrn: isLegalEntity !== wasLegalEntity ? '' : profile.ogrn,
    // ИНН меняет длину (10 vs 12) — сбрасываем если длина изменилась
    inn: innLenChanged ? '' : profile.inn,
  }
}

function emptyProfile(type: ProfileType): Omit<Profile, 'id'> {
  return {
    type, name: '', inn: '', kpp: '', ogrn: '', ogrnDate: '', legalAddress: '', email: '',
    signatorName: '', signatorPosition: '', signatorBasis: '',
    signatureFilePath: null, stampFilePath: null,
    bankDetails: [{ ...EMPTY_BANK }],
  }
}

function profileToForm(p: Profile): Omit<Profile, 'id'> {
  return {
    type: p.type, name: p.name,
    inn: p.inn ?? '', kpp: p.kpp ?? '', ogrn: p.ogrn ?? '', ogrnDate: p.ogrnDate ?? '',
    legalAddress: p.legalAddress ?? '', email: p.email ?? '',
    signatorName: p.signatorName ?? '', signatorPosition: p.signatorPosition ?? '',
    signatorBasis: p.signatorBasis ?? '',
    signatureFilePath: p.signatureFilePath, stampFilePath: p.stampFilePath,
    bankDetails: p.bankDetails.length > 0 ? p.bankDetails : [{ ...EMPTY_BANK }],
  }
}

// ─── Компонент загрузки файла ─────────────────────────────────────────────────

function FileUploadZone({ label, hint, value, onChange }: {
  label: string; hint: string; value: string | null; onChange: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className="flex-1 border border-dashed border-[var(--line-2)] rounded-[var(--radius-md)] flex flex-col items-center justify-center gap-[6px] py-[20px] cursor-pointer hover:border-[var(--line-strong)] transition-colors"
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f) }} />
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="max-h-[40px] object-contain" />
          <p className="text-[12px] text-[var(--ink-3)]">Нажмите чтобы заменить</p>
        </>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p className="text-[13px] text-[var(--ink-3)]">{label}</p>
          <p className="text-[11px] text-[var(--ink-4)]">{hint}</p>
        </>
      )}
    </div>
  )
}

// ─── Форма реквизитов ─────────────────────────────────────────────────────────

function ProfileForm({ profile, onChange, isNew }: {
  profile: Omit<Profile, 'id'>
  onChange: (updated: Omit<Profile, 'id'>) => void
  isNew: boolean
}) {
  const bank = profile.bankDetails[0] ?? { ...EMPTY_BANK }
  const set = (key: keyof Omit<Profile, 'id' | 'bankDetails'>, val: string) =>
    onChange({ ...profile, [key]: val })
  const setBank = (key: keyof BankDetail, val: string) =>
    onChange({ ...profile, bankDetails: [{ ...bank, [key]: val }] })
  // G.2: при смене типа сбрасываем несовместимые поля (только при создании)
  const handleTypeChange = (newType: ProfileType) =>
    onChange(clearTypeSpecificFields(profile, newType))

  const innError = profile.inn ? validateInn(profile.inn) : null
  const ogrnError = profile.ogrn ? validateOgrn(profile.ogrn, profile.type === 'COMPANY' ? 'company' : 'ip') : null
  const bikError = bank.bik ? validateBik(bank.bik) : null
  const accountError = bank.checkingAccount ? validateCheckingAccount(bank.checkingAccount, bank.bik) : null
  const kppError = profile.kpp ? validateKpp(profile.kpp) : null

  return (
    <div className="flex flex-col gap-[12px]">
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">Основное</p>
        <div className="flex flex-col gap-[12px]">
          {/* Тип профиля */}
          <Field label="Тип">
            {isNew ? (
              // При создании — выбор типа кнопками
              <div className="flex flex-wrap gap-[6px]">
                {(['SOLE_PROPRIETOR', 'COMPANY', 'INDIVIDUAL', 'ANO', 'PAO', 'ZAO'] as ProfileType[]).map((t) => (
                  <button key={t} onClick={() => handleTypeChange(t)}
                    className={['px-[12px] h-[32px] rounded-[var(--radius-md)] text-[12px] font-medium border transition-colors cursor-pointer',
                      profile.type === t ? 'border-[var(--ink)] bg-[var(--surface-inset)] text-[var(--ink)]' : 'border-[var(--line-2)] text-[var(--ink-3)] hover:border-[var(--line-strong)]',
                    ].join(' ')}>
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            ) : (
              // При редактировании — тип зафиксирован, только бейдж
              <div className="flex items-center gap-[8px]">
                <span className={['text-[12px] font-semibold px-[10px] py-[4px] rounded-[var(--radius-md)]', TYPE_COLORS[profile.type]].join(' ')}>
                  {TYPE_LABELS[profile.type]}
                </span>
                <span className="text-[12px] text-[var(--ink-4)]">Тип зафиксирован при создании</span>
              </div>
            )}
          </Field>

          <Field label="Полное наименование">
            <Input value={profile.name} onChange={(e) => set('name', e.target.value)}
              placeholder={profile.type === 'SOLE_PROPRIETOR' ? 'Индивидуальный предприниматель Иванов Иван Иванович' : profile.type === 'COMPANY' ? 'Общество с ограниченной ответственностью «Название»' : 'Иванов Иван Иванович'} />
          </Field>

          {/* ИНН, КПП, ОГРН — набор полей зависит от типа */}
          {(() => {
            const isLegal = TYPE_HAS_KPP.has(profile.type)
            const inn10 = TYPE_INN_10.has(profile.type)
            const isIndividual = profile.type === 'INDIVIDUAL'
            return (
              <div className={`grid gap-[12px] ${isLegal ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {!isIndividual && (
                  <Field label={inn10 ? 'ИНН (10 цифр)' : 'ИНН (12 цифр)'}>
                    <Input value={profile.inn}
                      onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, inn10 ? 10 : 12))}
                      placeholder={inn10 ? '7723456789' : '772345678901'}
                      error={innError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                  </Field>
                )}
                {isLegal && (
                  <Field label="КПП (9 цифр)">
                    <Input value={profile.kpp} onChange={(e) => set('kpp', e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="772301001" error={kppError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                  </Field>
                )}
                {!isIndividual && (
                  <Field label={isLegal ? 'ОГРН (13 цифр)' : 'ОГРНИП (15 цифр)'}>
                    <Input value={profile.ogrn}
                      onChange={(e) => set('ogrn', e.target.value.replace(/\D/g, '').slice(0, isLegal ? 13 : 15))}
                      placeholder={isLegal ? '1234567890123' : '318774600412345'}
                      error={ogrnError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
                  </Field>
                )}
              </div>
            )
          })()}

          {profile.type === 'SOLE_PROPRIETOR' && (
            <Field label="Дата присвоения ОГРНИП">
              <Input value={profile.ogrnDate} onChange={(e) => set('ogrnDate', e.target.value)}
                placeholder="Например: 05.10.2018" />
            </Field>
          )}

          <Field label="Юридический адрес">
            <Input value={profile.legalAddress} onChange={(e) => set('legalAddress', e.target.value)}
              placeholder="123056, г. Москва, ул. Красина, д. 17, кв. 42" />
          </Field>

          {profile.type === 'SOLE_PROPRIETOR' && (
            <Field label="Email">
              <Input type="email" value={profile.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                placeholder="your@email.ru" />
            </Field>
          )}
        </div>
      </Card>

      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">Банковские реквизиты</p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Банк">
            <Input value={bank.bankName} onChange={(e) => setBank('bankName', e.target.value)} placeholder='АО «Тинькофф Банк»' />
          </Field>
          <Field label="Расчётный счёт">
            <Input value={bank.checkingAccount}
              onChange={(e) => setBank('checkingAccount', e.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="40802 810 1 0000 1234567" error={accountError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
          </Field>
          <div className="grid grid-cols-2 gap-[12px]">
            <Field label="БИК">
              <Input value={bank.bik} onChange={(e) => setBank('bik', e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder="044525974" error={bikError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
            </Field>
            <Field label="Корр. счёт">
              <Input value={bank.correspondentAccount}
                onChange={(e) => setBank('correspondentAccount', e.target.value.replace(/\D/g, '').slice(0, 20))}
                placeholder="30101 810 1 4525 00009" style={{ fontFamily: 'var(--font-mono)' }} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">Подпись и печать</p>
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-2 gap-[12px]">
            <Field label="Подписант (ФИО)">
              <Input value={profile.signatorName} onChange={(e) => set('signatorName', e.target.value)} placeholder="Иванов Иван Иванович" />
            </Field>
            <Field label="Должность">
              <Input value={profile.signatorPosition} onChange={(e) => set('signatorPosition', e.target.value)}
                placeholder={
                  profile.type === 'SOLE_PROPRIETOR' ? 'Индивидуальный предприниматель'
                  : profile.type === 'INDIVIDUAL' ? ''
                  : 'Генеральный директор'
                } />
            </Field>
          </div>
          <Field label="Действует на основании">
            <Input value={profile.signatorBasis} onChange={(e) => set('signatorBasis', e.target.value)}
              placeholder={
                profile.type === 'SOLE_PROPRIETOR' ? 'Свидетельства о регистрации'
                : profile.type === 'INDIVIDUAL' ? 'Паспорта'
                : 'Устава'
              } />
          </Field>
          <div className="flex gap-[12px] mt-[4px]">
            <FileUploadZone label="Загрузить факсимиле" hint="PNG, SVG — без фона" value={profile.signatureFilePath} onChange={() => {}} />
            <FileUploadZone label="Загрузить печать" hint="PNG, SVG — без фона" value={profile.stampFilePath} onChange={() => {}} />
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function RequisitesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Omit<Profile, 'id'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/profiles')
      .then((r) => r.json())
      .then((data: Profile[]) => {
        setProfiles(data)
        // Автооткрыть первый профиль если он есть
        if (data.length > 0 && selectedId === null) {
          setSelectedId(data[0].id)
          setDraft(profileToForm(data[0]))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelect = (p: Profile) => {
    setSelectedId(p.id)
    setDraft(profileToForm(p))
    setSaveError(null)
  }

  const handleNew = () => {
    setSelectedId('new')
    setDraft(emptyProfile('SOLE_PROPRIETOR'))
    setSaveError(null)
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true); setSaveError(null)
    try {
      const payload = {
        ...draft,
        bankName: draft.bankDetails[0]?.bankName ?? '',
        checkingAccount: draft.bankDetails[0]?.checkingAccount ?? '',
        bik: draft.bankDetails[0]?.bik ?? '',
        correspondentAccount: draft.bankDetails[0]?.correspondentAccount ?? '',
      }

      let res: Response
      if (selectedId === 'new') {
        res = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      } else {
        res = await fetch(`/api/profiles/${selectedId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      }

      if (!res.ok) { const e = await res.json(); setSaveError(e.error ?? 'Ошибка сохранения'); return }

      const saved: Profile = await res.json()
      setProfiles((prev) => {
        if (selectedId === 'new') return [...prev, saved]
        return prev.map((p) => p.id === selectedId ? saved : p)
      })
      setSelectedId(saved.id)
    } finally { setSaving(false) }
  }

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    const id = deleteConfirmId
    if (!id) return
    setDeleteConfirmId(null)
    setDeletingId(id)
    await fetch(`/api/profiles/${id}`, { method: 'DELETE' })
    const next = profiles.filter((p) => p.id !== id)
    setProfiles(next)
    if (selectedId === id) {
      if (next.length > 0) { setSelectedId(next[0].id); setDraft(profileToForm(next[0])) }
      else { setSelectedId(null); setDraft(null) }
    }
    setDeletingId(null)
  }

  const handleCancel = () => {
    if (selectedId === 'new') {
      setSelectedId(profiles[0]?.id ?? null)
      setDraft(profiles[0] ? profileToForm(profiles[0]) : null)
    } else {
      const orig = profiles.find((p) => p.id === selectedId)
      if (orig) setDraft(profileToForm(orig))
    }
    setSaveError(null)
  }

  const [tab, setTab] = useState<'account' | 'requisites'>('account')

  return (
    <div className="max-w-[960px]">
      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Удалить профиль реквизитов?"
        message="Профиль будет удалён. Это действие нельзя отменить."
        confirmLabel="Удалить"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
      <div className="mb-[24px]">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 16, lineHeight: 1.2 }}>
          Настройки
        </h2>
        <div className="flex gap-[2px] border-b border-[var(--line)]">
          {([
            { key: 'account', label: 'Аккаунт' },
            { key: 'requisites', label: 'Реквизиты компаний' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="h-[38px] px-[16px] text-[13px] font-medium transition-colors cursor-pointer relative"
              style={{ color: tab === t.key ? 'var(--ink)' : 'var(--ink-3)' }}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--ink)] rounded-t-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'account' && <AccountTab />}
      {tab === 'requisites' && <RequisitesContent loading={loading} saving={saving} profiles={profiles} selectedId={selectedId} setSelectedId={setSelectedId} draft={draft} setDraft={setDraft} saveError={saveError} setSaveError={setSaveError} handleNew={handleNew} handleSave={handleSave} handleDelete={handleDelete} handleCancel={handleCancel} handleSelect={handleSelect} deletingId={deletingId} />}
    </div>
  )
}

// ─── Вкладка Аккаунт ──────────────────────────────────────────────────────────

function AccountTab() {
  const { user, setUser } = useAuthStore()
  const { toast } = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  async function handleSaveProfile() {
    setSavingProfile(true)
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error ?? 'Ошибка сохранения', 'error'); return }
      setUser({ ...user!, name: data.user.name, email: data.user.email })
      toast('Профиль обновлён', 'success')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) { toast('Пароли не совпадают', 'error'); return }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error ?? 'Ошибка', 'error'); return }
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      toast('Пароль изменён', 'success')
    } finally {
      setSavingPassword(false)
    }
  }

  const initials = (user?.name || user?.email || '?').slice(0, 1).toUpperCase()

  return (
    <div className="flex flex-col gap-[20px] max-w-[560px]">
      {/* Аватар */}
      <Card>
        <div className="flex items-center gap-[16px]">
          <div className="w-[56px] h-[56px] rounded-full bg-[oklch(0.88_0.04_260)] flex items-center justify-center text-[20px] font-semibold shrink-0" style={{ color: 'var(--accent)' }}>
            {initials}
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--ink)]">{user?.name || 'Имя не указано'}</p>
            <p className="text-[13px] text-[var(--ink-3)]">{user?.email}</p>
          </div>
        </div>
      </Card>

      {/* Основные данные */}
      <Card>
        <p className="text-[11px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">Личные данные</p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Имя">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          </Field>
        </div>
        <div className="mt-[16px]">
          <Button variant="primary" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </Card>

      {/* Смена пароля */}
      <Card>
        <p className="text-[11px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">Смена пароля</p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Текущий пароль">
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Новый пароль">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Повторите новый пароль">
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
          </Field>
        </div>
        <div className="mt-[16px]">
          <Button variant="secondary" onClick={handleChangePassword} disabled={savingPassword || !currentPassword || !newPassword}>
            {savingPassword ? 'Сохраняю…' : 'Изменить пароль'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ─── Контент реквизитов (вынесен из основного компонента) ─────────────────────

function RequisitesContent({ loading, saving, profiles, selectedId, draft, setDraft, saveError, setSaveError, handleNew, handleSave, handleDelete, handleCancel, handleSelect, deletingId }: {
  loading: boolean; saving: boolean; profiles: Profile[]; selectedId: string | null; setSelectedId?: (id: string | null) => void
  draft: Omit<Profile, 'id'> | null; setDraft: (d: Omit<Profile, 'id'> | null) => void; saveError: string | null; setSaveError: (e: string | null) => void
  handleNew: () => void; handleSave: () => void; handleDelete: (id: string) => void; handleCancel: () => void
  handleSelect: (p: Profile) => void; deletingId: string | null
}) {
  return (
    <div>
      <p className="text-[14px] text-[var(--ink-3)] mb-[20px]">
        Данные компаний и ИП — автоматически подставляются в договоры.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-[60px]">
          <div className="w-[20px] h-[20px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-[240px_1fr] gap-[20px] items-start">

          {/* ─── Левая колонка: список профилей ─── */}
          <div className="flex flex-col gap-[6px]">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className={[
                  'w-full flex items-start gap-[10px] px-[12px] py-[10px] rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer group',
                  selectedId === p.id
                    ? 'border-[var(--ink)] bg-[var(--surface-inset)]'
                    : 'border-[var(--line-2)] hover:border-[var(--line-strong)] bg-[var(--surface)]',
                ].join(' ')}
              >
                <span className={['text-[11px] font-semibold px-[6px] py-[2px] rounded shrink-0 mt-[1px]', TYPE_COLORS[p.type]].join(' ')}>
                  {TYPE_LABELS[p.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[var(--ink)] leading-tight truncate">
                    {p.name || <span className="text-[var(--ink-4)] italic">Без названия</span>}
                  </p>
                  {p.inn && <p className="text-[11px] text-[var(--ink-4)] mt-[2px]" style={{ fontFamily: 'var(--font-mono)' }}>{p.inn}</p>}
                </div>
                {deletingId !== p.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[var(--ink-4)] hover:text-[var(--danger)] transition-all cursor-pointer"
                    title="Удалить"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                )}
              </button>
            ))}

            {/* Новый профиль выбран */}
            {selectedId === 'new' && (
              <div className="w-full flex items-center gap-[10px] px-[12px] py-[10px] rounded-[var(--radius-md)] border border-[var(--ink)] bg-[var(--surface-inset)]">
                <span className={['text-[11px] font-semibold px-[6px] py-[2px] rounded shrink-0', TYPE_COLORS[draft?.type ?? 'SOLE_PROPRIETOR']].join(' ')}>
                  {TYPE_LABELS[draft?.type ?? 'SOLE_PROPRIETOR']}
                </span>
                <p className="text-[13px] text-[var(--ink-4)] italic">Новый профиль</p>
              </div>
            )}

            <button
              onClick={handleNew}
              className="w-full flex items-center gap-[8px] px-[12px] py-[9px] rounded-[var(--radius-md)] border border-dashed border-[var(--line-2)] hover:border-[var(--line-strong)] text-[var(--ink-3)] hover:text-[var(--ink-2)] transition-colors cursor-pointer text-[13px] font-medium mt-[2px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Добавить профиль
            </button>
          </div>

          {/* ─── Правая колонка: форма + превью ─── */}
          <div>
            {draft ? (
              <div className="grid grid-cols-[1fr_220px] gap-[16px] items-start">
                <div>
                  <ProfileForm profile={draft} onChange={(u) => { setDraft(u); setSaveError(null) }} isNew={selectedId === 'new'} />
                  <div className="flex items-center justify-between mt-[16px] pt-[16px] border-t border-[var(--line)]">
                    <div>{saveError && <p className="text-[13px] text-[var(--danger)]">{saveError}</p>}</div>
                    <div className="flex items-center gap-[12px]">
                      <Button variant="ghost" onClick={handleCancel}>Отмена</Button>
                      <Button variant="primary" onClick={handleSave} loading={saving}>Сохранить изменения</Button>
                    </div>
                  </div>
                </div>

                {/* Превью реквизитов */}
                <div className="sticky top-[20px]">
                  <Card>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-4)] mb-[12px]">
                      Вид в договоре
                    </p>
                    <RequisitesPreview
                      data={{
                        type: draft.type,
                        name: draft.name,
                        inn: draft.inn,
                        kpp: draft.kpp,
                        ogrn: draft.ogrn,
                        legalAddress: draft.legalAddress,
                        email: draft.email,
                        signatorName: draft.signatorName,
                        signatorPosition: draft.signatorPosition,
                        bankName: draft.bankDetails[0]?.bankName,
                        bik: draft.bankDetails[0]?.bik,
                        checkingAccount: draft.bankDetails[0]?.checkingAccount,
                        correspondentAccount: draft.bankDetails[0]?.correspondentAccount,
                      } satisfies RequisitesData}
                    />
                  </Card>
                </div>
              </div>
            ) : (
              <Card>
                <div className="py-[60px] text-center">
                  <p className="text-[14px] font-medium text-[var(--ink-2)] mb-[8px]">Профилей пока нет</p>
                  <p className="text-[13px] text-[var(--ink-4)] mb-[20px]">Добавьте первый профиль — ИП, ООО или физлицо</p>
                  <Button variant="primary" onClick={handleNew}>+ Добавить профиль</Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

