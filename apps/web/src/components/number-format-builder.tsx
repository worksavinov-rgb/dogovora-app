'use client'

/**
 * Выбор вида номера договора.
 *
 * Раньше здесь было голое поле для шаблона со списком плейсхолдеров под ним
 * ({NNN}, {ММ}, {ГГ}…). Человек открывал его и не понимал, что писать: язык
 * шаблонов очевиден только тому, кто его придумал. Поэтому теперь выбор из
 * готовых видов с живым примером, а шаблон собирается сам и остаётся деталью
 * реализации — формат хранения не изменился.
 *
 * Ручной ввод шаблона никуда не делся, он спрятан под ссылкой: у кого номер
 * уже сложился в нестандартном виде, тот сможет его вписать.
 */

import { useMemo, useState } from 'react'
import { Input, Field } from '@/components/ui/input'
import {
  renderNumber,
  validateFormat,
  formatScope,
  SCOPE_LABELS,
  PLACEHOLDER_HINTS,
} from '@/lib/document-number'

interface Preset {
  /** Шаблон без префикса */
  body: string
  title: string
  hint: string
}

const PRESETS: Preset[] = [
  { body: '{NNN}/{ММ}-{ГГ}', title: 'Номер, месяц и год', hint: 'счёт начинается заново каждый месяц' },
  { body: '{NNN}/{ГГГГ}', title: 'Номер и год', hint: 'счёт начинается заново каждый год' },
  { body: '{NNN}.{ММ}.{ГГГГ}', title: 'Номер и дата через точку', hint: 'счёт начинается заново каждый месяц' },
  { body: '{NNN}', title: 'Просто по порядку', hint: 'сквозная нумерация, без сброса' },
]

/** Собрать полный шаблон из префикса и выбранного вида. */
function compose(prefix: string, body: string): string {
  const p = prefix.trim()
  return p ? `${p}-${body}` : body
}

/** Разобрать сохранённый шаблон обратно: префикс + один из готовых видов. */
function decompose(format: string): { prefix: string; body: string } | null {
  for (const { body } of PRESETS) {
    if (format === body) return { prefix: '', body }
    if (format.endsWith(`-${body}`)) {
      const prefix = format.slice(0, -(body.length + 1))
      // Префикс не должен сам содержать плейсхолдеров — иначе это уже ручной шаблон.
      if (prefix && !prefix.includes('{')) return { prefix, body }
    }
  }
  return null
}

interface Props {
  value: string
  onChange: (format: string) => void
}

export function NumberFormatBuilder({ value, onChange }: Props) {
  const parsed = useMemo(() => decompose(value), [value])

  // Шаблон, не разложимый на «префикс + готовый вид», открываем сразу в ручном
  // режиме: молча подменить его ближайшим похожим значило бы поменять человеку
  // нумерацию без спроса.
  const [manual, setManual] = useState(() => value.trim() !== '' && parsed === null)
  const [prefix, setPrefix] = useState(parsed?.prefix ?? '')
  const [body, setBody] = useState(parsed?.body ?? '')

  const enabled = manual ? value.trim() !== '' : body !== ''
  const effective = manual ? value : (body ? compose(prefix, body) : '')
  const error = enabled ? validateFormat(effective) : null

  const example = useMemo(() => {
    if (!enabled || error) return null
    const now = new Date()
    return {
      first: renderNumber(effective, 1, now),
      next: renderNumber(effective, 27, now),
      scope: SCOPE_LABELS[formatScope(effective)],
    }
  }, [effective, enabled, error])

  const pick = (nextBody: string) => {
    const chosen = nextBody === body ? '' : nextBody
    setBody(chosen)
    onChange(chosen ? compose(prefix, chosen) : '')
  }

  const changePrefix = (p: string) => {
    setPrefix(p)
    if (body) onChange(compose(p, body))
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="text-[12px] text-[var(--ink-3)]">
        Догодок сам подставит следующий номер, когда вы создаёте договор. Выберите, как он должен выглядеть.
      </p>

      {!manual && (
        <>
          <div className="flex flex-col gap-[8px]">
            {PRESETS.map((p) => {
              const active = body === p.body
              return (
                <button
                  key={p.body}
                  type="button"
                  onClick={() => pick(p.body)}
                  className={[
                    'text-left flex items-center gap-[12px] px-[14px] py-[11px] rounded-[var(--radius-md)] border transition-colors cursor-pointer',
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] hover:border-[var(--ink-4)] hover:bg-[var(--surface-2)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'w-[14px] h-[14px] rounded-full border shrink-0 flex items-center justify-center',
                      active ? 'border-[var(--accent)]' : 'border-[var(--line-2)]',
                    ].join(' ')}
                  >
                    {active && <span className="w-[7px] h-[7px] rounded-full bg-[var(--accent)]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-[var(--ink)]">{p.title}</span>
                    <span className="block text-[11px] text-[var(--ink-4)] mt-[1px]">{p.hint}</span>
                  </span>
                  <span
                    className="text-[13px] text-[var(--ink-2)] shrink-0"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {renderNumber(compose(prefix, p.body), 1, new Date())}
                  </span>
                </button>
              )
            })}
          </div>

          <Field label="Буквы перед номером (необязательно)">
            <Input
              value={prefix}
              onChange={(e) => changePrefix(e.target.value.slice(0, 12))}
              placeholder="Например: Д, ИСП, МСК"
            />
          </Field>
          <p className="text-[11px] text-[var(--ink-4)] -mt-[8px]">
            Так помечают вид договора или подразделение: Д — договор, С — счёт, А — акт.
          </p>
        </>
      )}

      {manual && (
        <Field label="Шаблон номера">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="{NNN}/{ММ}-{ГГ}"
            style={{ fontFamily: 'var(--font-mono)' }}
            error={error?.message}
          />
          <div className="mt-[8px] flex flex-wrap gap-x-[14px] gap-y-[3px]">
            {PLACEHOLDER_HINTS.map((h) => (
              <span key={h.token} className="text-[11px] text-[var(--ink-4)]">
                <span style={{ fontFamily: 'var(--font-mono)' }}>{h.token}</span> — {h.label}
              </span>
            ))}
          </div>
        </Field>
      )}

      {/* Живой пример — он объясняет формат лучше любого списка плейсхолдеров. */}
      {example && (
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-inset)] px-[14px] py-[12px]">
          <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[6px]">Как будут выглядеть номера</p>
          <p className="text-[15px] text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
            {example.first} &nbsp;·&nbsp; {example.next}
          </p>
          <p className="text-[11px] text-[var(--ink-3)] mt-[5px]">{example.scope}</p>
        </div>
      )}

      {!enabled && (
        <p className="text-[12px] text-[var(--ink-4)]">
          Ничего не выбрано — номер придётся вписывать вручную при создании каждого договора.
        </p>
      )}

      <button
        type="button"
        onClick={() => setManual((m) => !m)}
        className="self-start text-[12px] text-[var(--ink-4)] hover:text-[var(--ink-2)] underline underline-offset-2 transition-colors cursor-pointer"
      >
        {manual ? 'Вернуться к выбору' : 'Задать свой шаблон вручную'}
      </button>
    </div>
  )
}
