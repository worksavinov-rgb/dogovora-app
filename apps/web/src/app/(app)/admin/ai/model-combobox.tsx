'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface ModelOption {
  id: string
  name: string
  description?: string
}

interface ModelComboboxProps {
  value: string
  options: ModelOption[]
  disabled?: boolean
  placeholder?: string
  /** Подпись опции в списке (например со ★) */
  optionLabel?: (m: ModelOption) => string
  onChange: (modelId: string) => void
}

function matchesQuery(m: ModelOption, q: string): boolean {
  if (!q) return true
  const hay = `${m.id} ${m.name} ${m.description ?? ''}`.toLowerCase()
  return q.split(/\s+/).filter(Boolean).every((part) => hay.includes(part))
}

/** Выпадающий список моделей с ленивым поиском по id/имени. */
export function ModelCombobox({
  value,
  options,
  disabled,
  placeholder = '— выберите модель —',
  optionLabel,
  onChange,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((m) => m.id === value)
  const displayClosed = selected
    ? (optionLabel ? optionLabel(selected) : selected.name)
    : ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? options.filter((m) => matchesQuery(m, q)) : options
    return list.slice(0, 80)
  }, [options, query])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  if (disabled) {
    return (
      <input
        disabled
        className="h-[32px] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-white text-[13px] min-w-[200px] w-full max-w-[280px] disabled:opacity-50"
        value={displayClosed || placeholder}
        readOnly
      />
    )
  }

  return (
    <div ref={rootRef} className="relative min-w-[200px] max-w-[280px] w-full">
      <button
        type="button"
        className="w-full h-[32px] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-white text-[13px] text-left truncate hover:border-[var(--ink-4)]"
        onClick={() => setOpen((v) => !v)}
        title={value || undefined}
      >
        <span className={displayClosed ? 'text-[var(--ink)]' : 'text-[var(--ink-4)]'}>
          {displayClosed || placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 min-w-[260px] rounded-[var(--radius-md)] border border-[var(--line)] bg-white shadow-md overflow-hidden">
          <div className="p-1.5 border-b border-[var(--line)]">
            <input
              ref={inputRef}
              type="search"
              autoComplete="off"
              placeholder="Поиск: claude, gpt-4o…"
              className="w-full h-[30px] px-2 rounded-[var(--radius-sm)] border border-[var(--line)] text-[13px] outline-none focus:border-[var(--ink-3)]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
                if (e.key === 'Enter' && filtered[0]) {
                  onChange(filtered[0].id)
                  setOpen(false)
                }
              }}
            />
          </div>
          <ul className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-[var(--ink-4)]">Ничего не найдено</li>
            )}
            {filtered.map((m) => {
              const label = optionLabel ? optionLabel(m) : m.name
              const active = m.id === value
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-inset)] ${
                      active ? 'bg-[var(--surface-inset)] font-medium' : ''
                    }`}
                    title={m.description ? `${m.id} — ${m.description}` : m.id}
                    onClick={() => {
                      onChange(m.id)
                      setOpen(false)
                    }}
                  >
                    <span className="block truncate text-[var(--ink)]">{label}</span>
                    {m.name !== m.id && (
                      <span className="block truncate text-[10px] text-[var(--ink-4)] font-mono">{m.id}</span>
                    )}
                  </button>
                </li>
              )
            })}
            {options.length > 80 && query.trim() === '' && (
              <li className="px-3 py-1.5 text-[10px] text-[var(--ink-4)] border-t border-[var(--line)]">
                Показаны первые 80. Введите текст для поиска по всему списку.
              </li>
            )}
            {query.trim() !== '' && filtered.length === 80 && (
              <li className="px-3 py-1.5 text-[10px] text-[var(--ink-4)] border-t border-[var(--line)]">
                Показаны первые 80 совпадений — уточните запрос
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
