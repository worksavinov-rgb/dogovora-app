'use client'

import { useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { validateInn, validateOgrn, validateBik, validateCheckingAccount, validateKpp } from '@/lib/validation'

// ─── Типы ─────────────────────────────────────────────────────────────────────

type ProfileType = 'SOLE_PROPRIETOR' | 'COMPANY' | 'INDIVIDUAL'

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
  legalAddress: string
  signatorName: string
  signatorPosition: string
  signatorBasis: string
  signatureFilePath: string | null
  stampFilePath: string | null
  bankDetails: BankDetail[]
}

const TYPE_LABELS: Record<ProfileType, string> = {
  SOLE_PROPRIETOR: 'ИП',
  COMPANY: 'Юрлицо',
  INDIVIDUAL: 'Физлицо',
}

const TYPE_COLORS: Record<ProfileType, string> = {
  SOLE_PROPRIETOR: 'bg-[oklch(0.92_0.05_280)] text-[oklch(0.35_0.1_280)]',
  COMPANY: 'bg-[oklch(0.92_0.05_200)] text-[oklch(0.35_0.1_200)]',
  INDIVIDUAL: 'bg-[oklch(0.92_0.04_100)] text-[oklch(0.35_0.08_100)]',
}

const EMPTY_BANK: BankDetail = { bankName: '', checkingAccount: '', bik: '', correspondentAccount: '' }

function emptyProfile(type: ProfileType): Omit<Profile, 'id'> {
  return {
    type, name: '', inn: '', kpp: '', ogrn: '', legalAddress: '',
    signatorName: '', signatorPosition: '', signatorBasis: '',
    signatureFilePath: null, stampFilePath: null,
    bankDetails: [{ ...EMPTY_BANK }],
  }
}

function profileToForm(p: Profile): Omit<Profile, 'id'> {
  return {
    type: p.type, name: p.name,
    inn: p.inn ?? '', kpp: p.kpp ?? '', ogrn: p.ogrn ?? '',
    legalAddress: p.legalAddress ?? '',
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

function ProfileForm({ profile, onChange }: {
  profile: Omit<Profile, 'id'>
  onChange: (updated: Omit<Profile, 'id'>) => void
}) {
  const bank = profile.bankDetails[0] ?? { ...EMPTY_BANK }
  const set = (key: keyof Omit<Profile, 'id' | 'bankDetails'>, val: string) =>
    onChange({ ...profile, [key]: val })
  const setBank = (key: keyof BankDetail, val: string) =>
    onChange({ ...profile, bankDetails: [{ ...bank, [key]: val }] })

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
            <div className="flex gap-[8px]">
              {(['SOLE_PROPRIETOR', 'COMPANY', 'INDIVIDUAL'] as ProfileType[]).map((t) => (
                <button key={t} onClick={() => set('type', t)}
                  className={['px-[12px] h-[34px] rounded-[var(--radius-md)] text-[13px] font-medium border transition-colors cursor-pointer',
                    profile.type === t ? 'border-[var(--ink)] bg-[var(--surface-inset)] text-[var(--ink)]' : 'border-[var(--line-2)] text-[var(--ink-3)] hover:border-[var(--line-strong)]',
                  ].join(' ')}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Полное наименование">
            <Input value={profile.name} onChange={(e) => set('name', e.target.value)}
              placeholder={profile.type === 'SOLE_PROPRIETOR' ? 'Индивидуальный предприниматель Иванов Иван Иванович' : profile.type === 'COMPANY' ? 'Общество с ограниченной ответственностью «Название»' : 'Иванов Иван Иванович'} />
          </Field>

          <div className={`grid gap-[12px] ${profile.type === 'COMPANY' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Field label={profile.type === 'COMPANY' ? 'ИНН (10 цифр)' : 'ИНН (12 цифр)'}>
              <Input value={profile.inn}
                onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, profile.type === 'COMPANY' ? 10 : 12))}
                placeholder={profile.type === 'COMPANY' ? '7723456789' : '772345678901'}
                error={innError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
            </Field>
            {profile.type === 'COMPANY' && (
              <Field label="КПП (9 цифр)">
                <Input value={profile.kpp} onChange={(e) => set('kpp', e.target.value.replace(/\D/g, '').slice(0, 9))}
                  placeholder="772301001" error={kppError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
              </Field>
            )}
            <Field label={profile.type === 'COMPANY' ? 'ОГРН (13 цифр)' : 'ОГРНИП (15 цифр)'}>
              <Input value={profile.ogrn}
                onChange={(e) => set('ogrn', e.target.value.replace(/\D/g, '').slice(0, profile.type === 'COMPANY' ? 13 : 15))}
                placeholder={profile.type === 'COMPANY' ? '1234567890123' : '318774600412345'}
                error={ogrnError ?? undefined} style={{ fontFamily: 'var(--font-mono)' }} />
            </Field>
          </div>

          <Field label="Юридический адрес">
            <Input value={profile.legalAddress} onChange={(e) => set('legalAddress', e.target.value)}
              placeholder="123056, г. Москва, ул. Красина, д. 17, кв. 42" />
          </Field>
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
                placeholder={profile.type === 'SOLE_PROPRIETOR' ? 'Индивидуальный предприниматель' : profile.type === 'COMPANY' ? 'Генеральный директор' : ''} />
            </Field>
          </div>
          <Field label="Действует на основании">
            <Input value={profile.signatorBasis} onChange={(e) => set('signatorBasis', e.target.value)}
              placeholder={profile.type === 'SOLE_PROPRIETOR' ? 'Свидетельства о регистрации' : profile.type === 'COMPANY' ? 'Устава' : 'Паспорта'} />
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

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить этот профиль реквизитов?')) return
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

  return (
    <div className="max-w-[960px]">
      <div className="mb-[24px]">
        <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[4px]">Профиль</p>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 8, lineHeight: 1.2 }}>
          Мои реквизиты
        </h2>
        <p className="text-[14px] text-[var(--ink-3)]">
          Данные компаний и ИП — автоматически подставляются в договоры. Добавьте столько профилей, сколько нужно.
        </p>
      </div>

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

          {/* ─── Правая колонка: форма ─── */}
          <div>
            {draft ? (
              <>
                <ProfileForm profile={draft} onChange={(u) => { setDraft(u); setSaveError(null) }} />
                <div className="flex items-center justify-between mt-[16px] pt-[16px] border-t border-[var(--line)]">
                  <div>{saveError && <p className="text-[13px] text-[var(--danger)]">{saveError}</p>}</div>
                  <div className="flex items-center gap-[12px]">
                    <Button variant="ghost" onClick={handleCancel}>Отмена</Button>
                    <Button variant="primary" onClick={handleSave} loading={saving}>Сохранить изменения</Button>
                  </div>
                </div>
              </>
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
