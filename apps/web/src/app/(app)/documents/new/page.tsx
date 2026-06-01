'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { calcVersionPrice } from '@/lib/pricing'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Field, Textarea } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'

// mammoth.js подгружается динамически только в браузере
async function parseDocxToText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

// ─── Типы ─────────────────────────────────────────────────────────────────────

type DocType = 'CONTRACT' | 'APPENDIX' | 'AMENDMENT'
type DocBase = 'scratch' | 'template' | 'upload'

interface Counterparty { id: string; name: string; inn: string | null }
interface ParentDocument { id: string; title: string; number: string | null }
interface Template { id: string; name: string; updatedAt: string }
interface Profile { id: string; type: string; name: string; inn: string | null }

const PROFILE_TYPE_LABELS: Record<string, string> = {
  SOLE_PROPRIETOR: 'ИП', COMPANY: 'ООО/АО', INDIVIDUAL: 'Физлицо',
  ANO: 'АНО', PAO: 'ПАО', ZAO: 'ЗАО',
}

interface Step1Data {
  type: DocType
  profileId: string        // моя компания (профиль пользователя)
  counterpartyId: string
  title: string
  number: string
  signingDate: string      // дата подписания (YYYY-MM-DD), необязательная
  base: DocBase
  uploadedFile?: File | null
  uploadedText?: string
  templateId?: string      // выбранный шаблон
  templateText?: string    // загруженный контент шаблона
  parentDocumentId?: string  // для APPENDIX/AMENDMENT
}

interface Step2Data {
  description: string
  protectionLevel: number
  targetSize: number
  customInstruction: string
  selectedChips: string[]  // лейблы выбранных чипсов
}

// ─── Кастомный дропдаун с поиском ────────────────────────────────────────────

interface DropdownOption {
  id: string
  label: string
  sublabel?: string | null
  badge?: string
  badgeColor?: string
}

function SearchableDropdown({
  value, options, placeholder, searchPlaceholder, emptyText, onChange, disabled,
}: {
  value: string
  options: DropdownOption[]
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const id = useId()

  const selected = options.find((o) => o.id === value)

  const filtered = search
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        (o.sublabel ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : options

  // Закрываем при клике снаружи
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Фокус на поиск при открытии
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={containerRef} className="relative" id={id}>
      {/* Кнопка-триггер */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={[
          'w-full h-[38px] px-[12px] flex items-center gap-[8px] rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer',
          open ? 'border-[var(--accent)]' : 'border-[var(--line-2)] hover:border-[var(--line-strong)]',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        style={{ background: 'var(--surface)' }}
      >
        {selected ? (
          <>
            {selected.badge && (
              <span className={['text-[10px] font-semibold px-[6px] py-[1px] rounded shrink-0', selected.badgeColor ?? ''].join(' ')}>
                {selected.badge}
              </span>
            )}
            <span className="flex-1 min-w-0 text-[14px] text-[var(--ink)] truncate">{selected.label}</span>
            {selected.sublabel && (
              <span className="text-[12px] text-[var(--ink-4)] shrink-0" style={{ fontFamily: 'var(--font-mono)' }}>
                {selected.sublabel}
              </span>
            )}
          </>
        ) : (
          <span className="flex-1 text-[14px] text-[var(--ink-4)]">{placeholder}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Выпадающий список */}
      {open && (
        <div
          className="absolute z-50 w-full mt-[4px] rounded-[var(--radius-md)] shadow-lg overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--line-2)' }}
        >
          {/* Строка поиска */}
          <div className="relative p-[8px] border-b border-[var(--line)]">
            <svg className="absolute left-[18px] top-1/2 -translate-y-1/2 text-[var(--ink-4)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder ?? 'Поиск…'}
              className="w-full h-[32px] pl-[30px] pr-[8px] text-[13px] bg-[var(--surface-inset)] rounded-[var(--radius-md)] outline-none border border-[var(--line-2)] focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Список вариантов */}
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {filtered.length === 0 ? (
              <p className="text-[13px] text-[var(--ink-4)] text-center py-[16px] px-[12px]">
                {search ? `Ничего не найдено по «${search}»` : (emptyText ?? 'Нет вариантов')}
              </p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelect(opt.id)}
                  className={[
                    'w-full flex items-center gap-[8px] px-[12px] py-[9px] text-left transition-colors cursor-pointer hover:bg-[var(--surface-inset)]',
                    value === opt.id ? 'bg-[var(--surface-inset)]' : '',
                  ].join(' ')}
                >
                  {opt.badge && (
                    <span className={['text-[10px] font-semibold px-[6px] py-[1px] rounded shrink-0', opt.badgeColor ?? ''].join(' ')}>
                      {opt.badge}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--ink)] truncate">{opt.label}</p>
                    {opt.sublabel && (
                      <p className="text-[11px] text-[var(--ink-4)] truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                        {opt.sublabel}
                      </p>
                    )}
                  </div>
                  {value === opt.id && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="oklch(0.42 0.06 260)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const DOC_TYPES = [
  { key: 'CONTRACT' as DocType, label: 'Договор', sub: 'Основной документ', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  )},
  { key: 'APPENDIX' as DocType, label: 'Приложение', sub: 'К существующему договору', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
  )},
  { key: 'AMENDMENT' as DocType, label: 'Доп. соглашение', sub: 'Изменения к договору', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  )},
]

const BASE_OPTIONS = [
  { key: 'scratch' as DocBase, label: 'С нуля по описанию', sub: 'ИИ составит с чистого листа' },
  { key: 'template' as DocBase, label: 'Из шаблона', sub: 'Мои загруженные шаблоны' },
  { key: 'upload' as DocBase, label: 'Загрузить файл', sub: 'PDF, DOCX, RTF' },
]

const QUICK_CHIPS: { label: string; instruction: string }[] = [
  { label: 'NDA', instruction: 'Добавить раздел о неразглашении конфиденциальной информации (NDA): стороны обязуются не раскрывать третьим лицам сведения, полученные в ходе исполнения договора, в течение 3 лет.' },
  { label: 'Этапы оплаты', instruction: 'Оплата поэтапная: 30% аванс при подписании, 40% по итогам промежуточной сдачи, 30% после финальной приёмки.' },
  { label: 'Подсудность', instruction: 'Все споры рассматриваются в Арбитражном суде города Москвы.' },
  { label: 'Передача прав', instruction: 'Исключительные права на результат работ передаются Заказчику в полном объёме после финальной оплаты.' },
  { label: 'Форс-мажор', instruction: 'Включить раздел о форс-мажоре: стороны освобождаются от ответственности при обстоятельствах непреодолимой силы, уведомление — в течение 5 рабочих дней.' },
]

// ─── Шаг 1 ───────────────────────────────────────────────────────────────────

function Step1({ data, onChange, profiles, counterparties, templates, loadingTemplate }: {
  data: Step1Data
  onChange: (d: Step1Data) => void
  profiles: Profile[]
  counterparties: Counterparty[]
  templates: Template[]
  loadingTemplate: boolean
}) {
  const set = <K extends keyof Step1Data>(k: K, v: Step1Data[K]) => onChange({ ...data, [k]: v })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parentDocs, setParentDocs] = useState<ParentDocument[]>([])
  const [parentDocsSearch, setParentDocsSearch] = useState('')
  const [parentDocsLoading, setParentDocsLoading] = useState(false)
  const [parentDocsOpen, setParentDocsOpen] = useState(false)
  const parentDocsRef = useRef<HTMLDivElement>(null)
  const needsParent = data.type === 'APPENDIX' || data.type === 'AMENDMENT'

  // Загружаем договоры при смене типа или контрагента
  // Закрываем дропдаун по клику вне
  useEffect(() => {
    if (!parentDocsOpen) return
    const handler = (e: MouseEvent) => {
      if (parentDocsRef.current && !parentDocsRef.current.contains(e.target as Node)) {
        setParentDocsOpen(false)
        setParentDocsSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [parentDocsOpen])

  useEffect(() => {
    if (!needsParent) return
    setParentDocsLoading(true)
    const url = data.counterpartyId
      ? `/api/documents?type=CONTRACT&counterpartyId=${data.counterpartyId}`
      : '/api/documents?type=CONTRACT'
    fetch(url)
      .then((r) => r.ok ? r.json() : [])
      .then((raw: unknown) => {
        const docs = Array.isArray(raw) ? raw as Array<{ id: string; title: string; number: string | null }> : []
        setParentDocs(docs)
        // если выбранный родительский договор больше не в списке — сбрасываем
        if (data.parentDocumentId && docs.length > 0 && !docs.find((d) => d.id === data.parentDocumentId)) {
          set('parentDocumentId', undefined)
        }
      })
      .catch(() => {})
      .finally(() => setParentDocsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsParent, data.counterpartyId])

  const handleFile = async (file: File) => {
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
    const title = data.title || baseName

    // Сначала показываем файл сразу — не ждём парсинга
    const initial = { ...data, uploadedFile: file, uploadedText: '', title }
    onChange(initial)

    // Асинхронно парсим текст в зависимости от типа
    try {
      if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        const text = await parseDocxToText(file)
        onChange({ ...initial, uploadedText: text })
      } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.rtf')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const text = e.target?.result as string
          onChange({ ...initial, uploadedText: text })
        }
        reader.readAsText(file, 'utf-8')
      }
    } catch (err) {
      console.warn('Не удалось распарсить файл:', err)
      // Файл всё равно загружен, текст просто не извлечён
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Тип документа */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Тип документа</p>
        <div className="grid grid-cols-3 gap-[10px]">
          {DOC_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => set('type', t.key)}
              className={['flex flex-col gap-[8px] p-[14px] rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer', data.type === t.key ? 'border-[var(--ink)] bg-[var(--surface-inset)]' : 'border-[var(--line-2)] hover:border-[var(--line-strong)]'].join(' ')}
            >
              <span className={data.type === t.key ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'}>{t.icon}</span>
              <div>
                <p className="text-[13px] font-medium text-[var(--ink)]">{t.label}</p>
                <p className="text-[12px] text-[var(--ink-4)]">{t.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Стороны договора — только компания и контрагент */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Стороны договора</p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Моя компания">
            {(profiles ?? []).length === 0 ? (
              <div className="flex items-center gap-[8px] px-[12px] py-[9px] rounded-[var(--radius-md)] text-[13px] text-[var(--ink-4)]"
                style={{ background: 'var(--surface-inset)', border: '1px solid var(--line-2)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Нет профилей —{' '}
                <a href="/requisites" className="text-[var(--accent-ink)] hover:underline">добавить в «Мои реквизиты»</a>
              </div>
            ) : (
              <SearchableDropdown
                value={data.profileId}
                placeholder="Выберите вашу компанию"
                searchPlaceholder="Поиск по названию или ИНН…"
                emptyText="Профили не найдены"
                onChange={(id) => set('profileId', id)}
                options={(profiles ?? []).map((p) => ({
                  id: p.id,
                  label: p.name,
                  sublabel: p.inn ?? null,
                  badge: PROFILE_TYPE_LABELS[p.type] ?? p.type,
                  badgeColor: p.type === 'SOLE_PROPRIETOR'
                    ? 'bg-[oklch(0.92_0.05_280)] text-[oklch(0.35_0.1_280)]'
                    : p.type === 'INDIVIDUAL'
                    ? 'bg-[oklch(0.92_0.04_100)] text-[oklch(0.35_0.08_100)]'
                    : 'bg-[oklch(0.92_0.05_200)] text-[oklch(0.35_0.1_200)]',
                }))}
              />
            )}
          </Field>

          <Field label="Контрагент">
            <SearchableDropdown
              value={data.counterpartyId}
              placeholder="Выберите контрагента"
              searchPlaceholder="Поиск по названию или ИНН…"
              emptyText="Контрагентов пока нет"
              onChange={(id) => set('counterpartyId', id)}
              options={counterparties.map((cp) => ({
                id: cp.id,
                label: cp.name,
                sublabel: cp.inn ?? null,
              }))}
            />
            {data.counterpartyId && (
              <p className="mt-[4px] text-[12px] text-[var(--ink-4)]">
                Реквизиты подставятся автоматически.{' '}
                <a href="/counterparties/new" className="text-[var(--accent-ink)] hover:underline">Добавить нового</a>
              </p>
            )}
          </Field>
        </div>
      </Card>

      {/* Привязка к родительскому договору (для Приложений и ДС) — теперь ВЫШЕ реквизитов */}
      {needsParent && (() => {
        const q = parentDocsSearch.toLowerCase()
        const filtered = q
          ? parentDocs.filter((d) =>
              d.title.toLowerCase().includes(q) ||
              (d.number ?? '').toLowerCase().includes(q)
            )
          : parentDocs

        return (
          <Card>
            <div className="flex items-start gap-[10px] mb-[14px]">
              <div className="shrink-0 w-[28px] h-[28px] rounded-full bg-[oklch(0.95_0.015_260)] flex items-center justify-center mt-[1px]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="oklch(0.42 0.06 260)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--ink)]">Привязать к договору?</p>
                <p className="text-[12px] text-[var(--ink-4)] mt-[1px]">
                  {data.type === 'APPENDIX' ? 'Приложение' : 'Доп. соглашение'} получит автоматический номер — система посчитает сколько уже есть и присвоит следующий.
                </p>
              </div>
            </div>

            {!data.counterpartyId ? (
              <div className="flex items-center gap-[8px] px-[12px] py-[10px] rounded-[var(--radius-md)] text-[12px] text-[var(--ink-4)]"
                style={{ background: 'var(--surface-inset)', border: '1px solid var(--line-2)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Сначала выберите контрагента выше — покажем его договоры
              </div>
            ) : parentDocsLoading ? (
              <div className="flex items-center justify-center py-[16px] gap-[8px] text-[12px] text-[var(--ink-4)]">
                <div className="w-[12px] h-[12px] rounded-full border-2 border-[var(--line)] border-t-[var(--ink-3)] animate-spin" />
                Загружаю договоры…
              </div>
            ) : (
              <div ref={parentDocsRef} className="relative">
                <button
                  type="button"
                  onClick={() => { setParentDocsOpen((v) => !v); setParentDocsSearch('') }}
                  className="w-full flex items-center justify-between gap-[8px] h-[40px] px-[12px] rounded-[var(--radius-md)] border text-[13px] transition-colors cursor-pointer"
                  style={{
                    borderColor: parentDocsOpen ? 'var(--accent)' : 'var(--line-2)',
                    background: 'var(--surface)',
                    color: data.parentDocumentId ? 'var(--ink)' : 'var(--ink-4)',
                  }}
                >
                  <span className="truncate">
                    {data.parentDocumentId
                      ? (() => {
                          const d = parentDocs.find((x) => x.id === data.parentDocumentId)
                          return d ? `${d.title}${d.number ? ` — № ${d.number}` : ''}` : 'Выбран договор'
                        })()
                      : 'Без привязки — самостоятельный документ'}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: parentDocsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {parentDocsOpen && (
                  <div
                    className="absolute left-0 right-0 top-[44px] z-50 rounded-[var(--radius-md)] overflow-hidden"
                    style={{ background: 'white', border: '1px solid var(--line-2)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}
                  >
                    <div className="p-[8px] border-b border-[var(--line)]">
                      <div className="relative">
                        <svg className="absolute left-[8px] top-1/2 -translate-y-1/2 text-[var(--ink-4)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input
                          autoFocus
                          type="text"
                          value={parentDocsSearch}
                          onChange={(e) => setParentDocsSearch(e.target.value)}
                          placeholder="Поиск по названию или номеру…"
                          className="w-full h-[32px] pl-[28px] pr-[8px] text-[13px] bg-[var(--surface-inset)] rounded-[var(--radius-sm)] outline-none"
                        />
                      </div>
                    </div>

                    <div className="max-h-[240px] overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => { onChange({ ...data, parentDocumentId: undefined, number: '' }); setParentDocsOpen(false) }}
                        className="w-full flex items-center justify-between px-[12px] py-[10px] text-left hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-[var(--ink)]">Без привязки</p>
                          <p className="text-[11px] text-[var(--ink-4)]">Самостоятельный документ</p>
                        </div>
                        {!data.parentDocumentId && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </button>

                      {filtered.length === 0 ? (
                        <p className="text-[12px] text-[var(--ink-4)] text-center py-[14px] px-[12px]">
                          {parentDocsSearch ? `Ничего не найдено по «${parentDocsSearch}»` : `У этого контрагента нет договоров`}
                        </p>
                      ) : (
                        filtered.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => {
                              // Считаем следующий порядковый номер для этого типа у данного родительского договора
                              const existingCount = parentDocs.filter(() => true).indexOf(doc) // placeholder, real count fetched below
                              fetch(`/api/documents?type=${data.type}&parentDocumentId=${doc.id}`)
                                .then((r) => r.ok ? r.json() : [])
                                .then((existing: Array<{ documentNumber?: number | null }>) => {
                                  const maxNum = existing.reduce((m, d) => Math.max(m, d.documentNumber ?? 0), 0)
                                  onChange({ ...data, parentDocumentId: doc.id, number: String(maxNum + 1) })
                                })
                                .catch(() => { onChange({ ...data, parentDocumentId: doc.id }) })
                              setParentDocsOpen(false)
                              setParentDocsSearch('')
                            }}
                            className="w-full flex items-center justify-between px-[12px] py-[10px] text-left hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
                          >
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-[var(--ink)] truncate">{doc.title}</p>
                              {doc.number && <p className="text-[11px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>№ {doc.number}</p>}
                            </div>
                            {data.parentDocumentId === doc.id && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 ml-[8px]"><polyline points="20 6 9 17 4 12"/></svg>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })()}

      {/* Реквизиты документа — название, дата, номер */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Реквизиты документа</p>
        <div className="flex flex-col gap-[12px]">
          <Field label="Название документа">
            <Input
              value={data.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={data.type === 'APPENDIX' ? 'Приложение № 1 к договору' : data.type === 'AMENDMENT' ? 'Дополнительное соглашение № 1' : 'Договор на разработку сайта'}
            />
          </Field>

          <div className="grid grid-cols-[200px_1fr] gap-[10px]">
            <Field label="Дата подписания">
              <div className="relative">
                <Input
                  type="date"
                  value={data.signingDate}
                  onChange={(e) => set('signingDate', e.target.value)}
                  style={{ paddingRight: data.signingDate ? 32 : undefined }}
                />
                {data.signingDate && (
                  <button
                    type="button"
                    onClick={() => set('signingDate', '')}
                    className="absolute right-[8px] top-1/2 -translate-y-1/2 text-[var(--ink-4)] hover:text-[var(--danger)] text-[16px] leading-none cursor-pointer"
                  >×</button>
                )}
              </div>
              <p className="mt-[3px] text-[11px] text-[var(--ink-4)]">Необязательно</p>
            </Field>
            <Field label={needsParent ? 'Порядковый номер (присвоен системой)' : 'Номер'}>
              <Input
                value={data.number}
                onChange={(e) => set('number', e.target.value)}
                placeholder={needsParent ? 'Автоматически' : '17/03'}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* База */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">База для документа</p>
        <div className="grid grid-cols-3 gap-[10px] mb-[14px]">
          {BASE_OPTIONS.map((b) => (
            <button
              key={b.key}
              onClick={() => set('base', b.key)}
              className={['flex flex-col gap-[4px] p-[12px] rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer', data.base === b.key ? 'border-[var(--ink)] bg-[var(--surface-inset)]' : 'border-[var(--line-2)] hover:border-[var(--line-strong)]'].join(' ')}
            >
              <p className="text-[13px] font-medium text-[var(--ink)]">{b.label}</p>
              <p className="text-[11px] text-[var(--ink-4)]">{b.sub}</p>
            </button>
          ))}
        </div>


        {data.base === 'template' && (
          <>
            {templates.length === 0 ? (
              <div className="flex flex-col items-center gap-[10px] py-[24px] text-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
                </svg>
                <p className="text-[13px] text-[var(--ink-3)]">Нет загруженных шаблонов</p>
                <a href="/templates" className="text-[12px] text-[var(--accent-ink)] hover:underline">
                  Перейти в «Мои шаблоны» → загрузить
                </a>
              </div>
            ) : (
              <div className="flex flex-col gap-[6px]">
                {templates.map((tpl) => (
                  <label key={tpl.id}
                    className="flex items-center gap-[10px] p-[10px] rounded-[var(--radius-md)] border cursor-pointer transition-colors"
                    style={{
                      borderColor: data.templateId === tpl.id ? 'var(--ink)' : 'var(--line-2)',
                      background: data.templateId === tpl.id ? 'var(--surface-inset)' : 'transparent',
                    }}>
                    <input
                      type="radio"
                      checked={data.templateId === tpl.id}
                      onChange={() => set('templateId', tpl.id)}
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--ink)] truncate">{tpl.name}</p>
                      <p className="text-[11px] text-[var(--ink-4)]">
                        Обновлён {new Date(tpl.updatedAt).toLocaleDateString('ru', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    {data.templateId === tpl.id && (
                      loadingTemplate ? (
                        <span className="text-[11px] text-[var(--ink-4)]">Загружаю…</span>
                      ) : data.templateText ? (
                        <span className="text-[11px] text-[var(--ok)]">✓ Готово</span>
                      ) : null
                    )}
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {data.base === 'upload' && (
          <>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.rtf,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            {data.uploadedFile ? (
              <div className="flex items-center gap-[10px] p-[12px] rounded-[var(--radius-md)] border border-[var(--ok)] bg-[oklch(0.97_0.02_150)]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[var(--ink)] truncate">{data.uploadedFile.name}</p>
                  <p className="text-[11px] text-[var(--ink-4)]">{(data.uploadedFile.size / 1024).toFixed(0)} КБ</p>
                </div>
                <button onClick={() => onChange({ ...data, uploadedFile: null, uploadedText: '' })}
                  className="text-[var(--ink-4)] hover:text-[var(--danger)] transition-colors cursor-pointer text-[20px] leading-none">×</button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
                className={['flex flex-col items-center justify-center gap-[8px] p-[32px] rounded-[var(--radius-md)] border-2 border-dashed cursor-pointer transition-colors', dragOver ? 'border-[var(--accent)] bg-[oklch(0.97_0.02_260)]' : 'border-[var(--line-2)] hover:border-[var(--line-strong)] bg-[var(--surface-inset)]'].join(' ')}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p className="text-[13px] font-medium text-[var(--ink)]">Нажмите или перетащите файл</p>
                <p className="text-[12px] text-[var(--ink-4)]">PDF, DOCX, RTF, TXT — до 10 МБ</p>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// ─── Шаг 2: Настройки ИИ ─────────────────────────────────────────────────────

function Step2({ data, onChange }: { data: Step2Data; onChange: (d: Step2Data) => void }) {
  const set = <K extends keyof Step2Data>(k: K, v: Step2Data[K]) => onChange({ ...data, [k]: v })

  const addChip = (label: string, instruction: string) => {
    const isSelected = data.selectedChips.includes(label)
    if (isSelected) {
      // Снимаем выбор — убираем инструкцию и лейбл
      onChange({
        ...data,
        selectedChips: data.selectedChips.filter((c) => c !== label),
        customInstruction: data.customInstruction.replace(`\n${instruction}`, '').replace(instruction, '').trim(),
      })
    } else {
      onChange({
        ...data,
        selectedChips: [...data.selectedChips, label],
        customInstruction: data.customInstruction ? `${data.customInstruction}\n${instruction}` : instruction,
      })
    }
  }

  const protectionLabel = data.protectionLevel <= 30 ? 'Дружелюбный' : data.protectionLevel <= 60 ? 'Сбалансированный' : 'Жёсткий'

  // Приближённый расчёт страниц
  const pages = Math.round(data.targetSize / 2100)
  const sizeLabel = data.targetSize < 3000 ? 'Краткий' : data.targetSize < 12000 ? 'Стандартный' : 'Развёрнутый'

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Описание для ИИ */}
      <Card>
        <div className="flex items-start justify-between mb-[6px]">
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)]">Описание для ИИ</p>
            <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Опишите суть договора: предмет, стороны, сроки, ключевые условия. ИИ составит документ на основе этого описания.</p>
          </div>
          <span className="text-[12px] text-[var(--ink-4)] shrink-0 ml-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>
            {data.description.length} / 4000
          </span>
        </div>
        <Textarea
          value={data.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Например: договор на услуги фотографа на мероприятие 19–20 мая, один день, сумма 35 000 руб. вкл. НДС. Фотограф предоставляет архив в течение 20 рабочих дней..."
          style={{ minHeight: 120 }}
          charCount={data.description.length}
          maxChars={4000}
        />
      </Card>

      {/* Уровень защищённости */}
      <Card>
        <div className="mb-[6px]">
          <p className="text-[13px] font-medium text-[var(--ink)]">Уровень юридической защищённости</p>
          <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Чем выше — тем больше пунктов о неустойках, гарантиях, ответственности, защите ИС. Документ становится длиннее и жёстче.</p>
        </div>
        <Slider
          label=""
          value={data.protectionLevel}
          min={20} max={90} step={5}
          hint="Сбалансированный уровень — рекомендуем для коммерческих договоров"
          onChange={(v) => set('protectionLevel', v)}
          formatValue={(v) => `${v}%`}
        />
        <div className="flex justify-between mt-[4px]">
          {['Дружелюбный 20%','Сбалансированный 50%','Жёсткий 90%'].map((l) => (
            <p key={l} className="text-[11px] text-[var(--ink-4)]">{l}</p>
          ))}
        </div>
      </Card>

      {/* Целевой объём */}
      <Card>
        <div className="flex items-start justify-between mb-[6px]">
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)]">Целевой объём</p>
            <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Цифра означает знаков с пробелами. Финальный объём может слегка отличаться — ИИ оптимизирует под смысл.</p>
          </div>
        </div>
        <Slider
          label=""
          value={data.targetSize}
          min={1500} max={100000} step={500}
          hint={`≈ ${pages} ${pages === 1 ? 'страница' : pages < 5 ? 'страницы' : 'страниц'} А4 шрифтом 11pt`}
          onChange={(v) => set('targetSize', v)}
          formatValue={(v) => `${v.toLocaleString('ru')} зн.`}
        />
        <div className="flex justify-between mt-[4px]">
          {['< 4 страниц А4','Стандартный','Развёрнутый'].map((l) => (
            <p key={l} className="text-[11px] text-[var(--ink-4)]">{l}</p>
          ))}
        </div>
        {data.targetSize >= 45000 && (
          <div className="mt-[10px] px-[12px] py-[9px] rounded-[var(--radius-md)] text-[12px] leading-[1.5]"
            style={{ background: 'oklch(0.97 0.015 60)', border: '1px solid oklch(0.88 0.04 60)', color: 'oklch(0.45 0.08 60)' }}>
            ⚠ Большой объём не влияет на качество — формулировки могут быть размытыми или повторяющимися.
            После создания необходимо отредактировать и скорректировать документ.
          </div>
        )}
      </Card>

      {/* Инструкция */}
      <Card>
        <div className="flex items-start justify-between mb-[6px]">
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)]">Дополнительная инструкция</p>
            <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Опишите особенности этого договора своими словами. ИИ учтёт это при составлении.</p>
          </div>
          <span className="text-[12px] text-[var(--ink-4)] shrink-0 ml-[12px]" style={{ fontFamily:'var(--font-mono)' }}>
            {data.customInstruction.length} / 2000
          </span>
        </div>
        <Textarea
          value={data.customInstruction}
          onChange={(e) => set('customInstruction', e.target.value)}
          placeholder="Оплата поэтапная: 30% после утверждения дизайна, 40% после вёрстки, 30% после сдачи..."
          style={{ minHeight: 100 }}
        />
        <div className="flex flex-wrap gap-[6px] mt-[10px]">
          {QUICK_CHIPS.map((chip) => {
            const selected = data.selectedChips.includes(chip.label)
            return (
              <button
                key={chip.label}
                onClick={() => addChip(chip.label, chip.instruction)}
                className={[
                  'h-[28px] px-[10px] text-[12px] font-medium rounded-full border transition-colors cursor-pointer',
                  selected
                    ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                    : 'text-[var(--ink-2)] bg-[var(--surface-inset)] border-[var(--line-2)] hover:border-[var(--line-strong)]',
                ].join(' ')}
              >
                {selected ? '✓ ' : '+ '}{chip.label}
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────

export default function NewDocumentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedCounterpartyId = searchParams.get('counterpartyId') ?? ''
  const preselectedTemplateId = searchParams.get('templateId') ?? ''
  const preselectedParentDocId = searchParams.get('parentDocumentId') ?? ''
  const preselectedType = (searchParams.get('type') ?? 'CONTRACT') as DocType
  const [step, setStep] = useState(1)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step2Visited, setStep2Visited] = useState(false)

  const [step1, setStep1] = useState<Step1Data>({
    type: preselectedType,
    profileId: '',
    counterpartyId: preselectedCounterpartyId,
    title: '',
    number: '',
    signingDate: '',
    base: preselectedTemplateId ? 'template' : 'scratch',
    uploadedFile: null,
    uploadedText: '',
    templateId: preselectedTemplateId || undefined,
    parentDocumentId: preselectedParentDocId || undefined,
  })
  const [step2, setStep2] = useState<Step2Data>({
    description: '', protectionLevel: 65, targetSize: 8400, customInstruction: '', selectedChips: [],
  })

  // Загрузить профили и контрагентов параллельно
  useEffect(() => {
    fetch('/api/profiles')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Profile[]) => {
        setProfiles(data)
        // Автовыбор первого профиля
        if (data.length > 0) {
          setStep1((prev) => prev.profileId ? prev : { ...prev, profileId: data[0].id })
        }
      })
      .catch(console.error)
    fetch('/api/counterparties')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Counterparty[]) => { if (Array.isArray(data)) setCounterparties(data) })
      .catch(console.error)
  }, [])

  // Загрузить список шаблонов
  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.ok ? r.json() : [])
      .then((tpls: Template[]) => setTemplates(tpls))
      .catch(console.error)
  }, [])

  // Загрузить контент шаблона когда выбирается templateId
  const loadingTemplateIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = step1.templateId
    if (!id) return
    if (loadingTemplateIdRef.current === id) return  // уже грузим или загружен

    loadingTemplateIdRef.current = id
    setLoadingTemplate(true)
    fetch(`/api/templates/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((tpl: { content: string } | null) => {
        if (tpl) {
          setStep1((prev) => ({ ...prev, templateText: tpl.content }))
        }
      })
      .catch(console.error)
      .finally(() => setLoadingTemplate(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1.templateId])

  const versionPrice = calcVersionPrice(step1.type, step2.targetSize)

  const handleSaveDraft = async () => {
    // Если базовые поля не заполнены — возвращаемся на шаг 1 с ошибкой
    if (!step1.title.trim()) {
      setStep(1)
      setError('Укажите название документа')
      return
    }
    if (!step1.counterpartyId) {
      setStep(1)
      setError('Выберите контрагента')
      return
    }
    setSaving(true); setError(null)
    try {
      const uploadedContent =
        (step1.base === 'upload' && step1.uploadedText)
          ? step1.uploadedText
          : (step1.base === 'template' && step1.templateText)
            ? step1.templateText
            : undefined

      const { selectedChips: _chips, ...step2Rest } = step2

      // Для Приложений/ДС шаблон/файл — это образец структуры для ИИ (referenceContent),
      // а не финальный контент версии. ИИ синтезирует: родительский договор + образец + описание.
      // Для Договора — шаблон/файл сразу становится контентом версии (без генерации).
      const isChildDoc = step1.type === 'APPENDIX' || step1.type === 'AMENDMENT'
      const referenceContent = isChildDoc ? uploadedContent : undefined
      const versionContent = isChildDoc ? undefined : uploadedContent

      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: step1.type, title: step1.title, number: step1.number,
          signingDate: step1.signingDate || undefined,
          profileId: step1.profileId || undefined,
          counterpartyId: step1.counterpartyId,
          parentDocumentId: step1.parentDocumentId || undefined,
          uploadedContent: versionContent,
          aiSettings: {
            ...step2Rest,
            base: step1.base,
            profileId: step1.profileId || undefined,
            referenceContent: referenceContent || undefined,
          },
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setError(e.error ?? `Ошибка сервера (${res.status})`)
        return
      }
      const doc = await res.json()
      router.push(`/documents/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    await handleSaveDraft()
    // В Фазе 7 здесь будет запуск генерации через BullMQ
  }

  const STEPS = ['Основные параметры', 'Настройки ИИ', 'Создание черновика']
  const TYPE_LABELS: Record<string, string> = { CONTRACT:'Договор', APPENDIX:'Приложение', AMENDMENT:'Доп. соглашение' }

  return (
    <div className="max-w-[1080px]">
      {/* Заголовок */}
      <div className="mb-[8px]">
        <p className="text-[12px] text-[var(--ink-4)] mb-[4px]">Шаг {step} из 3</p>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:400, marginBottom:6 }}>
          {step === 1 ? 'Создание документа' : 'Настройки ИИ'}
        </h2>
        <p className="text-[14px] text-[var(--ink-3)]">
          {step === 1
            ? 'Выберите тип, контрагента и базу. ИИ подготовит первый черновик с учётом ваших настроек — это будет версия v.1.'
            : 'Задайте, насколько жёстко документ должен защищать ваши интересы и насколько он должен быть объёмным. При желании — добавьте инструкцию своими словами.'}
        </p>
      </div>

      {/* Прогресс шагов */}
      <div className="flex items-center gap-[0] mb-[24px] mt-[16px]">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-[8px]">
              <div className={['w-[24px] h-[24px] rounded-full flex items-center justify-center text-[12px] font-medium shrink-0', i + 1 < step ? 'bg-[var(--ok)] text-white' : i + 1 === step ? 'bg-[var(--ink)] text-[var(--bg)]' : 'bg-[var(--surface-2)] text-[var(--ink-4)]'].join(' ')}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <p className={['text-[13px]', i + 1 === step ? 'font-medium text-[var(--ink)]' : 'text-[var(--ink-4)]'].join(' ')}>{label}</p>
            </div>
            {i < STEPS.length - 1 && <div className="w-[32px] h-[1px] bg-[var(--line-2)] mx-[8px]" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-[20px]">
        {/* Основная форма */}
        <div>
          {step === 1 && (
            <Step1
              data={step1}
              onChange={(d) => {
                // Если templateId изменился — сбросить templateText чтобы перезагрузить
                if (d.templateId !== step1.templateId) {
                  setStep1({ ...d, templateText: undefined })
                } else {
                  setStep1(d)
                }
              }}
              profiles={profiles}
              counterparties={counterparties}
              templates={templates}
              loadingTemplate={loadingTemplate}
            />
          )}
          {step === 2 && <Step2 data={step2} onChange={setStep2} />}
        </div>

        {/* Правая панель */}
        <div className="flex flex-col gap-[12px]">
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">
              {step === 1 ? 'Стоимость версии' : 'Предпросмотр настроек'}
            </p>
            {step === 1 ? (
              <>
                {step2Visited ? (
                  <>
                    <p style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:400, marginBottom:4 }}>
                      {versionPrice} ₽
                    </p>
                    <p className="text-[12px] text-[var(--ink-4)] mb-[12px]">Списание при утверждении v.1</p>
                    <div className="bg-[var(--surface-inset)] rounded-[var(--radius-md)] px-[12px] py-[10px]">
                      <p className="text-[12px] text-[var(--ink-3)]">
                        Баланс: <span className="font-medium text-[var(--ink)]">0 ₽</span> — будет недостаточно
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-[6px]">
                    <p className="text-[13px] text-[var(--ink-3)] leading-[1.5]">Стоимость рассчитается на шаге «Настройки ИИ» — зависит от объёма и уровня защищённости.</p>
                  </div>
                )}
                <div className="mt-[12px] pt-[12px] border-t border-[var(--line)]">
                  <p className="text-[11px] text-[var(--ink-4)] mb-[6px]">Как считается стоимость?</p>
                  <p className="text-[12px] text-[var(--ink-3)] leading-[1.5]">Цена зависит от типа документа, объёма и уровня юридической защищённости. Деньги списываются только когда вы утверждаете версию.</p>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-[8px] text-[13px]">
                {/* Стоимость */}
                <div>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400, lineHeight: 1.1 }}>
                    {versionPrice} ₽
                  </p>
                  <p className="text-[12px] text-[var(--ink-4)] mt-[2px]">Списание при утверждении v.1</p>
                </div>
                <div className="pt-[8px] border-t border-[var(--line)] flex flex-col gap-[6px]">
                  <div className="flex justify-between">
                    <p className="text-[var(--ink-3)]">Защищённость</p>
                    <p className="font-medium">{step2.protectionLevel}%</p>
                  </div>
                  <div className="flex justify-between">
                    <p className="text-[var(--ink-3)]">Объём</p>
                    <p className="font-medium">~ {step2.targetSize.toLocaleString('ru')} зн.</p>
                  </div>
                  <div className="flex justify-between">
                    <p className="text-[var(--ink-3)]">Тон</p>
                    <p className="font-medium">{step2.protectionLevel >= 70 ? 'Формальный' : 'Деловой'}</p>
                  </div>
                </div>
                <div className="pt-[8px] border-t border-[var(--line)]">
                  <p className="text-[12px] text-[var(--ink-3)]">Деньги списываются только когда вы утверждаете версию.</p>
                </div>
              </div>
            )}
          </Card>

          {step === 1 && step1.title && (
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[8px]">Превью</p>
              <p className="text-[12px] text-[var(--ink-4)] mb-[2px]">{TYPE_LABELS[step1.type]}{step1.number ? ` № ${step1.number}` : ''}</p>
              <p className="text-[13px] font-medium text-[var(--ink)]">{step1.title}</p>
              {step1.counterpartyId && (
                <p className="text-[12px] text-[var(--ink-3)] mt-[4px]">
                  {counterparties.find((c) => c.id === step1.counterpartyId)?.name}
                </p>
              )}
              {step1.base === 'template' && step1.templateId && (
                <div className="mt-[8px] pt-[8px] border-t border-[var(--line)]">
                  <p className="text-[11px] text-[var(--ink-4)] mb-[2px]">Шаблон</p>
                  <p className="text-[12px] text-[var(--ink-3)] truncate">
                    {templates.find((t) => t.id === step1.templateId)?.name ?? '—'}
                  </p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Нижняя панель */}
      <div className="mt-[24px] pt-[16px] border-t border-[var(--line)]">
        {/* Ошибка — заметный баннер */}
        {error && (
          <div className="flex items-center gap-[8px] px-[14px] py-[10px] rounded-[var(--radius-md)] mb-[12px] text-[13px] font-medium"
            style={{ background: 'oklch(0.97 0.015 20)', border: '1px solid oklch(0.88 0.04 20)', color: 'oklch(0.45 0.12 20)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => step > 1 ? setStep(step - 1) : router.push('/documents')}>
            {step > 1 ? '← Назад' : 'Отменить'}
          </Button>
          <div className="flex items-center gap-[10px]">
            <Button variant="secondary" onClick={handleSaveDraft} loading={saving && step === 2}>
              Сохранить черновик
            </Button>
            {step === 1 ? (
              <Button variant="primary" onClick={() => {
                if (!step1.title.trim()) { setError('Укажите название документа'); return }
                if (!step1.counterpartyId) { setError('Выберите контрагента'); return }
                setError(null); setStep(2); setStep2Visited(true)
              }}>
                Далее →
              </Button>
            ) : (
              <Button variant="primary" onClick={handleCreate} loading={saving}>
                ✦ Создать документ
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
