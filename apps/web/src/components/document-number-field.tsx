'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Field, Input } from '@/components/ui/input'

// Поле номера документа: «следующий по порядку» или «свой номер».
//
// Один компонент на все точки ввода номера (мастер создания, загрузка файла,
// параметры документа, подписание) — раньше их было четыре независимых, и они
// неминуемо разъезжались.
//
// Если у юрлица формат номера не задан, компонент вырождается в обычное
// текстовое поле, поэтому он безопасен как замена везде.

interface NextNumberResponse {
  format: string | null
  next: string | null
  scope: string | null
  scopeLabel: string | null
  sample: string | null
}

interface Conflict {
  id: string
  title: string
  counterpartyName: string
}

export interface DocumentNumberFieldProps {
  profileId: string | null | undefined
  /** Дата подписания в формате YYYY-MM-DD; от неё зависит период счётчика. */
  signingDate?: string | null
  value: string
  onChange: (value: string) => void
  /** Исключить документ из проверки дубля — при редактировании самого себя. */
  excludeDocumentId?: string
  label?: string
  disabled?: boolean
}

export function DocumentNumberField({
  profileId,
  signingDate,
  value,
  onChange,
  excludeDocumentId,
  label = 'Номер договора',
  disabled = false,
}: DocumentNumberFieldProps) {
  const [suggestion, setSuggestion] = useState<NextNumberResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  // Явный выбор пользователя. Пока его нет, режим выводится из значения: у
  // документа с уже вписанным вручную номером радио должно стоять на «Свой
  // номер», а не врать, что номер взят из очереди.
  const [modeOverride, setModeOverride] = useState<'auto' | 'manual' | null>(null)

  // Зеркало в ref: эффект загрузки номера не перезапускается при смене режима,
  // поэтому из замыкания он видел бы устаревшее значение. Синхронизируем
  // эффектом, объявленным выше загрузки — эффекты выполняются по порядку
  // объявления, так что к моменту загрузки ref уже актуален.
  const modeOverrideRef = useRef(modeOverride)
  useEffect(() => {
    modeOverrideRef.current = modeOverride
  }, [modeOverride])

  // Порядковый номер последнего запроса: быстрая смена юрлица порождает
  // несколько запросов, и пришедший последним не обязательно самый свежий.
  const requestSeq = useRef(0)
  // Номер, который компонент подставил сам. Нужен, чтобы отличить «поле пустое,
  // потому что пользователь стёр» от «поле пустое, потому что ещё не заполняли».
  const autoFilled = useRef<string | null>(null)

  useEffect(() => {
    if (!profileId) {
      setSuggestion(null)
      return
    }

    const seq = ++requestSeq.current
    setLoading(true)

    const params = new URLSearchParams()
    if (signingDate) params.set('date', signingDate)

    fetch(`/api/profiles/${profileId}/next-number?${params}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NextNumberResponse | null) => {
        if (seq !== requestSeq.current) return
        setSuggestion(data)
        setLoading(false)

        // Подставляем предложенный номер, только если пользователь ещё ничего
        // своего не вписал — иначе смена даты затирала бы ручной ввод.
        if (
          data?.next &&
          modeOverrideRef.current !== 'manual' &&
          (value === '' || value === autoFilled.current)
        ) {
          autoFilled.current = data.next
          onChange(data.next)
        }
      })
      .catch(() => {
        if (seq !== requestSeq.current) return
        setSuggestion(null)
        setLoading(false)
      })
    // value и onChange намеренно вне зависимостей: пересчёт нужен только при
    // смене юрлица или даты, иначе каждый ввод символа бил бы в API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, signingDate])

  // Проверка занятости номера — с задержкой, чтобы не бить в API на каждую букву.
  useEffect(() => {
    const number = value.trim()
    if (!profileId || !number) {
      setConflict(null)
      return
    }

    const timer = setTimeout(() => {
      const params = new URLSearchParams({ profileId, number })
      if (excludeDocumentId) params.set('excludeId', excludeDocumentId)

      fetch(`/api/documents/number-check?${params}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { conflict: null }))
        .then((data: { conflict: Conflict | null }) => setConflict(data.conflict))
        .catch(() => setConflict(null))
    }, 400)

    return () => clearTimeout(timer)
  }, [profileId, value, excludeDocumentId])

  const warning = conflict && (
    <div className="mt-[8px] flex items-start gap-[8px] rounded-[var(--radius-md)] border border-[var(--warn)] bg-[var(--warn-soft)] px-[10px] py-[8px] text-[12px] text-[var(--ink-2)]">
      <span aria-hidden className="text-[var(--warn)]">!</span>
      <span>
        Номер <span className="font-mono">{value.trim()}</span> уже у документа{' '}
        <Link href={`/documents/${conflict.id}`} className="text-[var(--accent)] underline">
          {conflict.title}
        </Link>
        {conflict.counterpartyName ? ` (${conflict.counterpartyName})` : ''}. Сохранить всё
        равно можно.
      </span>
    </div>
  )

  // Нумерация не настроена или юрлицо не выбрано — обычное текстовое поле.
  if (!profileId || !suggestion?.format || !suggestion.next) {
    return (
      <Field label={label}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="17/03"
          disabled={disabled}
        />
        {!profileId && (
          <p className="mt-[3px] text-[11px] text-[var(--ink-4)]">
            Выберите своё юрлицо, чтобы система предложила следующий номер
          </p>
        )}
        {warning}
      </Field>
    )
  }

  const next = suggestion.next
  const mode: 'auto' | 'manual' =
    modeOverride ?? (value.trim() && value.trim() !== next ? 'manual' : 'auto')

  return (
    <Field label={label}>
      <div className="flex flex-col gap-[8px]">
        <label className="flex cursor-pointer items-center gap-[8px] text-[13px] text-[var(--ink)]">
          <input
            type="radio"
            checked={mode === 'auto'}
            disabled={disabled}
            onChange={() => {
              setModeOverride('auto')
              autoFilled.current = next
              onChange(next)
            }}
            className="accent-[var(--accent)]"
          />
          <span>
            Следующий по порядку — <span className="font-mono font-medium">{next}</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-[8px] text-[13px] text-[var(--ink)]">
          <input
            type="radio"
            checked={mode === 'manual'}
            disabled={disabled}
            onChange={() => {
              setModeOverride('manual')
              autoFilled.current = null
              // Чистим поле: иначе пользователь дописывает свой номер к
              // подставленному и получает «011/08-26010/08-26».
              onChange('')
            }}
            className="accent-[var(--accent)]"
          />
          <span>Свой номер</span>
        </label>

        {mode === 'manual' && (
          <Input
            value={value}
            autoFocus
            disabled={disabled}
            onChange={(e) => {
              autoFilled.current = null
              onChange(e.target.value)
            }}
            placeholder={suggestion.sample ?? '17/03'}
          />
        )}
      </div>

      <p className="mt-[6px] text-[11px] text-[var(--ink-4)]">
        Формат <span className="font-mono">{suggestion.format}</span>
        {suggestion.scopeLabel ? ` · ${suggestion.scopeLabel}` : ''}
        {loading ? ' · обновляем…' : ''}
      </p>

      {warning}
    </Field>
  )
}
