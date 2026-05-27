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

const TAB_LABELS: Record<ProfileType, string> = {
  SOLE_PROPRIETOR: 'ИП',
  COMPANY: 'ООО',
  INDIVIDUAL: 'Физлицо',
}

const EMPTY_BANK: BankDetail = { bankName: '', checkingAccount: '', bik: '', correspondentAccount: '' }

function emptyProfile(type: ProfileType): Omit<Profile, 'id'> {
  return {
    type,
    name: '',
    inn: '',
    kpp: '',
    ogrn: '',
    legalAddress: '',
    signatorName: '',
    signatorPosition: '',
    signatorBasis: '',
    signatureFilePath: null,
    stampFilePath: null,
    bankDetails: [{ ...EMPTY_BANK }],
  }
}

// ─── Компонент загрузки файла ─────────────────────────────────────────────────

function FileUploadZone({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string | null
  onChange: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className="flex-1 border border-dashed border-[var(--line-2)] rounded-[var(--radius-md)] flex flex-col items-center justify-center gap-[6px] py-[20px] cursor-pointer hover:border-[var(--line-strong)] transition-colors"
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onChange(f)
        }}
      />
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="max-h-[40px] object-contain" />
          <p className="text-[12px] text-[var(--ink-3)]">Нажмите чтобы заменить</p>
        </>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p className="text-[13px] text-[var(--ink-3)]">{label}</p>
          <p className="text-[11px] text-[var(--ink-4)]">{hint}</p>
        </>
      )}
    </div>
  )
}

// ─── Форма реквизитов ─────────────────────────────────────────────────────────

function ProfileForm({
  profile,
  onChange,
}: {
  profile: Omit<Profile, 'id'>
  onChange: (updated: Omit<Profile, 'id'>) => void
}) {
  const bank = profile.bankDetails[0] ?? { ...EMPTY_BANK }
  const set = (key: keyof Omit<Profile, 'id' | 'bankDetails'>, val: string) =>
    onChange({ ...profile, [key]: val })
  const setBank = (key: keyof BankDetail, val: string) =>
    onChange({ ...profile, bankDetails: [{ ...bank, [key]: val }] })

  // ─── Валидация ─────────────────────────────────────────────────────────────
  const innError = profile.inn ? validateInn(profile.inn) : null
  const ogrnError = profile.ogrn
    ? validateOgrn(profile.ogrn, profile.type === 'COMPANY' ? 'company' : 'ip')
    : null
  const bikError = bank.bik ? validateBik(bank.bik) : null
  const accountError = bank.checkingAccount
    ? validateCheckingAccount(bank.checkingAccount, bank.bik)
    : null
  const kppError = profile.kpp ? validateKpp(profile.kpp) : null

  return (
    <div className="flex flex-col gap-[12px]">
      {/* ОСНОВНОЕ */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">
          Основное
        </p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Полное наименование">
            <Input
              value={profile.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={
                profile.type === 'SOLE_PROPRIETOR'
                  ? 'Индивидуальный предприниматель Иванов Иван Иванович'
                  : profile.type === 'COMPANY'
                  ? 'Общество с ограниченной ответственностью «Название»'
                  : 'Иванов Иван Иванович'
              }
            />
          </Field>

          <div className={`grid gap-[12px] ${profile.type === 'COMPANY' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Field label={profile.type === 'COMPANY' ? 'ИНН (10 цифр)' : 'ИНН (12 цифр)'}>
              <Input
                value={profile.inn}
                onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, profile.type === 'COMPANY' ? 10 : 12))}
                placeholder={profile.type === 'COMPANY' ? '7723456789' : '772345678901'}
                error={innError ?? undefined}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </Field>

            {profile.type === 'COMPANY' && (
              <Field label="КПП (9 цифр)">
                <Input
                  value={profile.kpp}
                  onChange={(e) => set('kpp', e.target.value.replace(/\D/g, '').slice(0, 9))}
                  placeholder="772301001"
                  error={kppError ?? undefined}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </Field>
            )}

            <Field label={profile.type === 'COMPANY' ? 'ОГРН (13 цифр)' : profile.type === 'SOLE_PROPRIETOR' ? 'ОГРНИП (15 цифр)' : 'ОГРНИП'}>
              <Input
                value={profile.ogrn}
                onChange={(e) => set('ogrn', e.target.value.replace(/\D/g, '').slice(0, profile.type === 'COMPANY' ? 13 : 15))}
                placeholder={profile.type === 'COMPANY' ? '1234567890123' : '318774600412345'}
                error={ogrnError ?? undefined}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </Field>
          </div>

          <Field label="Юридический адрес">
            <Input
              value={profile.legalAddress}
              onChange={(e) => set('legalAddress', e.target.value)}
              placeholder="123056, г. Москва, ул. Красина, д. 17, кв. 42"
            />
          </Field>
        </div>
      </Card>

      {/* БАНКОВСКИЕ РЕКВИЗИТЫ */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">
          Банковские реквизиты
        </p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Банк">
            <Input
              value={bank.bankName}
              onChange={(e) => setBank('bankName', e.target.value)}
              placeholder='АО «Тинькофф Банк»'
            />
          </Field>
          <Field label="Расчётный счёт">
            <Input
              value={bank.checkingAccount}
              onChange={(e) => setBank('checkingAccount', e.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="40802 810 1 0000 1234567"
              error={accountError ?? undefined}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-[12px]">
            <Field label="БИК">
              <Input
                value={bank.bik}
                onChange={(e) => setBank('bik', e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder="044525974"
                error={bikError ?? undefined}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </Field>
            <Field label="Корр. счёт">
              <Input
                value={bank.correspondentAccount}
                onChange={(e) => setBank('correspondentAccount', e.target.value.replace(/\D/g, '').slice(0, 20))}
                placeholder="30101 810 1 4525 00009"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* ПОДПИСЬ И ПЕЧАТЬ */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">
          Подпись и печать
        </p>
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-2 gap-[12px]">
            <Field label="Подписант (ФИО)">
              <Input
                value={profile.signatorName}
                onChange={(e) => set('signatorName', e.target.value)}
                placeholder="Иванов Иван Иванович"
              />
            </Field>
            <Field label="Должность">
              <Input
                value={profile.signatorPosition}
                onChange={(e) => set('signatorPosition', e.target.value)}
                placeholder={
                  profile.type === 'SOLE_PROPRIETOR'
                    ? 'Индивидуальный предприниматель'
                    : profile.type === 'COMPANY'
                    ? 'Генеральный директор'
                    : ''
                }
              />
            </Field>
          </div>
          <Field label="Действует на основании">
            <Input
              value={profile.signatorBasis}
              onChange={(e) => set('signatorBasis', e.target.value)}
              placeholder={
                profile.type === 'SOLE_PROPRIETOR'
                  ? 'Свидетельства о регистрации'
                  : profile.type === 'COMPANY'
                  ? 'Устава'
                  : 'Паспорта'
              }
            />
          </Field>

          <div className="flex gap-[12px] mt-[4px]">
            <FileUploadZone
              label="Загрузить факсимиле"
              hint="PNG, SVG — без фона"
              value={profile.signatureFilePath}
              onChange={() => {/* TODO: upload to S3 */}}
            />
            <FileUploadZone
              label="Загрузить печать"
              hint="PNG, SVG — без фона"
              value={profile.stampFilePath}
              onChange={() => {/* TODO: upload to S3 */}}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function RequisitesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeType, setActiveType] = useState<ProfileType>('SOLE_PROPRIETOR')
  const [drafts, setDrafts] = useState<Record<string, Omit<Profile, 'id'>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ─── Загрузка профилей ────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/profiles')
      .then((r) => r.json())
      .then((data: Profile[]) => {
        setProfiles(data)
        // Инициализируем черновики из загруженных данных
        const initial: Record<string, Omit<Profile, 'id'>> = {}
        for (const p of data) {
          initial[p.type] = {
            type: p.type,
            name: p.name,
            inn: p.inn ?? '',
            kpp: p.kpp ?? '',
            ogrn: p.ogrn ?? '',
            legalAddress: p.legalAddress ?? '',
            signatorName: p.signatorName ?? '',
            signatorPosition: p.signatorPosition ?? '',
            signatorBasis: p.signatorBasis ?? '',
            signatureFilePath: p.signatureFilePath,
            stampFilePath: p.stampFilePath,
            bankDetails: p.bankDetails.length > 0 ? p.bankDetails : [{ ...EMPTY_BANK }],
          }
        }
        setDrafts(initial)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ─── Текущий черновик ─────────────────────────────────────────────────────

  const currentDraft = drafts[activeType] ?? emptyProfile(activeType)
  const existingProfile = profiles.find((p) => p.type === activeType)

  const setCurrentDraft = (updated: Omit<Profile, 'id'>) => {
    setDrafts((prev) => ({ ...prev, [activeType]: updated }))
    setSaveError(null)
  }

  // ─── Сохранение ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)

    try {
      const payload = {
        ...currentDraft,
        bankName: currentDraft.bankDetails[0]?.bankName ?? '',
        checkingAccount: currentDraft.bankDetails[0]?.checkingAccount ?? '',
        bik: currentDraft.bankDetails[0]?.bik ?? '',
        correspondentAccount: currentDraft.bankDetails[0]?.correspondentAccount ?? '',
      }

      let res: Response
      if (existingProfile) {
        res = await fetch(`/api/profiles/${existingProfile.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      if (!res.ok) {
        const err = await res.json()
        setSaveError(err.error ?? 'Ошибка сохранения')
        return
      }

      const saved: Profile = await res.json()
      setProfiles((prev) => {
        const idx = prev.findIndex((p) => p.type === activeType)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [...prev, saved]
      })
    } finally {
      setSaving(false)
    }
  }

  // ─── Отмена ───────────────────────────────────────────────────────────────

  const handleCancel = () => {
    if (existingProfile) {
      setDrafts((prev) => ({
        ...prev,
        [activeType]: {
          type: existingProfile.type,
          name: existingProfile.name,
          inn: existingProfile.inn ?? '',
          kpp: existingProfile.kpp ?? '',
          ogrn: existingProfile.ogrn ?? '',
          legalAddress: existingProfile.legalAddress ?? '',
          signatorName: existingProfile.signatorName ?? '',
          signatorPosition: existingProfile.signatorPosition ?? '',
          signatorBasis: existingProfile.signatorBasis ?? '',
          signatureFilePath: existingProfile.signatureFilePath,
          stampFilePath: existingProfile.stampFilePath,
          bankDetails:
            existingProfile.bankDetails.length > 0
              ? existingProfile.bankDetails
              : [{ ...EMPTY_BANK }],
        },
      }))
    } else {
      setDrafts((prev) => ({ ...prev, [activeType]: emptyProfile(activeType) }))
    }
    setSaveError(null)
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────

  const tabs: ProfileType[] = ['SOLE_PROPRIETOR', 'COMPANY', 'INDIVIDUAL']

  return (
    <div className="max-w-[800px]">
      {/* Заголовок */}
      <div className="mb-[24px]">
        <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[4px]">
          Профиль
        </p>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 8, lineHeight: 1.2 }}>
          Мои реквизиты
        </h2>
        <p className="text-[14px] text-[var(--ink-3)]">
          Эти данные автоматически подставляются в новые договоры и приложения. Можно сохранить несколько профилей — ИП, ООО, физлицо.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-[60px]">
          <div className="w-[20px] h-[20px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Табы + кнопка */}
          <div className="flex items-center justify-between mb-[20px]">
            <div className="flex gap-0 border-b border-[var(--line)]">
              {tabs.map((type) => {
                const hasProfile = profiles.some((p) => p.type === type)
                return (
                  <button
                    key={type}
                    onClick={() => setActiveType(type)}
                    className={[
                      'px-[16px] py-[10px] text-[14px] font-medium transition-colors relative cursor-pointer',
                      activeType === type
                        ? 'text-[var(--ink)]'
                        : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]',
                    ].join(' ')}
                  >
                    {TAB_LABELS[type]}
                    {hasProfile && (
                      <span className="ml-[6px] inline-block w-[6px] h-[6px] rounded-full bg-[var(--ok)] align-middle" />
                    )}
                    {activeType === type && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--ink)]" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Форма */}
          <ProfileForm profile={currentDraft} onChange={setCurrentDraft} />

          {/* Нижняя панель */}
          <div className="flex items-center justify-between mt-[20px] pt-[20px] border-t border-[var(--line)]">
            <div>
              {saveError && (
                <p className="text-[13px] text-[var(--danger)]">{saveError}</p>
              )}
            </div>
            <div className="flex items-center gap-[12px]">
              <Button variant="ghost" onClick={handleCancel}>
                Отмена
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                Сохранить изменения
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
