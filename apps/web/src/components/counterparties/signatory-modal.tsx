'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'

export type BasisType = 'CHARTER' | 'POA' | 'CERTIFICATE' | 'REGULATION' | 'OTHER'

export interface SignatoryData {
  id?: string
  fullName: string
  signatureName: string
  position: string
  basisType: BasisType
  poaNumber: string
  poaDate: string
  poaExpiry: string
  scopes: string[]
}

const BASIS_LABELS: Record<BasisType, string> = {
  CHARTER: 'Устав',
  POA: 'Доверенность',
  CERTIFICATE: 'Свидетельство',
  REGULATION: 'Положение',
  OTHER: 'Иное',
}

function basisPreviewText(s: SignatoryData): string {
  const name = s.signatureName || s.fullName || '___'
  const position = s.position || '___'
  switch (s.basisType) {
    case 'CHARTER':
      return `${position} ${name}, действующий на основании Устава`
    case 'POA':
      return `${position} ${name}, действующий на основании Доверенности № ${s.poaNumber || '___'} от ${s.poaDate || '___'}`
    case 'CERTIFICATE':
      return `${position} ${name}, действующий на основании Свидетельства о регистрации`
    case 'REGULATION':
      return `${position} ${name}, действующий на основании Положения`
    case 'OTHER':
      return `${position} ${name}, действующий на основании иного документа`
  }
}

function emptySignatory(): SignatoryData {
  return { fullName: '', signatureName: '', position: '', basisType: 'CHARTER', poaNumber: '', poaDate: '', poaExpiry: '', scopes: [] }
}

interface Props {
  initial?: SignatoryData | null
  counterpartyName?: string
  onSave: (data: SignatoryData) => Promise<void>
  onClose: () => void
}

export function SignatoryModal({ initial, counterpartyName, onSave, onClose }: Props) {
  const [data, setData] = useState<SignatoryData>(initial ?? emptySignatory())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(initial ?? emptySignatory())
  }, [initial])

  const set = <K extends keyof SignatoryData>(key: K, val: SignatoryData[K]) =>
    setData((prev) => ({ ...prev, [key]: val }))

  // Автозаполнение краткого имени
  const handleFullNameBlur = () => {
    if (!data.signatureName && data.fullName) {
      const parts = data.fullName.trim().split(/\s+/)
      if (parts.length >= 2) {
        const short = parts[0] + ' ' + parts.slice(1).map((p) => p[0] + '.').join(' ')
        set('signatureName', short)
      }
    }
  }

  const handleSave = async () => {
    if (!data.fullName.trim()) { setError('Укажите ФИО'); return }
    if (!data.position.trim()) { setError('Укажите должность'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(data)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/20 backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Panel */}
      <div className="relative w-[440px] h-full bg-[var(--surface)] shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-[12px] px-[24px] py-[20px] border-b border-[var(--line)]">
          <Avatar name={data.fullName || '?'} size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium">
              Подписант{counterpartyName ? ` · ${counterpartyName}` : ''}
            </p>
            <p className="text-[15px] font-medium text-[var(--ink)] truncate">
              {data.fullName || 'Новый подписант'}
            </p>
          </div>
          <button onClick={onClose} className="w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[24px] py-[20px] flex flex-col gap-[20px]">

          {/* Идентификация */}
          <div>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Идентификация</p>
            <div className="flex flex-col gap-[12px]">
              <Field label="ФИО полностью">
                <Input value={data.fullName} onChange={(e) => set('fullName', e.target.value)} onBlur={handleFullNameBlur} placeholder="Кравцова Мария Алексеевна" />
              </Field>
              <Field label="В подписи (краткое)">
                <Input value={data.signatureName} onChange={(e) => set('signatureName', e.target.value)} placeholder="Кравцова М. А." />
              </Field>
              <Field label="Должность">
                <Input value={data.position} onChange={(e) => set('position', e.target.value)} placeholder="Генеральный директор" />
              </Field>
            </div>
          </div>

          {/* Основание */}
          <div>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Основание подписания</p>
            <p className="text-[12px] text-[var(--ink-3)] mb-[8px]">Тип основания</p>
            <div className="flex flex-wrap gap-[6px] mb-[12px]">
              {(Object.keys(BASIS_LABELS) as BasisType[]).map((key) => (
                <button
                  key={key}
                  onClick={() => set('basisType', key)}
                  className={[
                    'h-[32px] px-[14px] rounded-full text-[13px] font-medium border transition-colors cursor-pointer',
                    data.basisType === key
                      ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                      : 'bg-[var(--surface)] text-[var(--ink-2)] border-[var(--line-2)] hover:border-[var(--line-strong)]',
                  ].join(' ')}
                >
                  {BASIS_LABELS[key]}
                </button>
              ))}
            </div>

            {data.basisType === 'POA' && (
              <div className="flex flex-col gap-[10px]">
                <Field label="Номер">
                  <Input value={data.poaNumber} onChange={(e) => set('poaNumber', e.target.value)} placeholder="№ 14" />
                </Field>
                <div className="grid grid-cols-2 gap-[10px]">
                  <Field label="Дата">
                    <Input type="date" value={data.poaDate} onChange={(e) => set('poaDate', e.target.value)} />
                  </Field>
                  <Field label="Действует до">
                    <Input type="date" value={data.poaExpiry} onChange={(e) => set('poaExpiry', e.target.value)} />
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* Превью */}
          {(data.fullName || data.position) && (
            <div className="bg-[var(--surface-inset)] rounded-[var(--radius-md)] px-[14px] py-[12px]">
              <p className="text-[11px] text-[var(--ink-4)] mb-[6px]">В тексте договора это будет звучать так:</p>
              <p className="text-[12px] text-[var(--ink-2)] italic leading-[1.5]">«…{basisPreviewText(data)}…»</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-[24px] py-[16px] border-t border-[var(--line)] flex items-center justify-between">
          {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
          <div className="flex gap-[8px] ml-auto">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>✓ Сохранить подписанта</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
