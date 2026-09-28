'use client'

/**
 * EditorToolbar — мини-тулбар редактируемого предпросмотра.
 * Только то, что переживает экспорт в DOCX: жирный, курсив, заголовки, списки
 * (конвертер packages/shared переносит bold/italics/заголовки/списки).
 */

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TEXT_ALIGN_TYPES, type TextAlignValue } from '@/lib/tiptap/text-align-class'
import { ORDERED_LIST_STYLES, DEFAULT_ORDERED_LIST_STYLE, type OrderedListStyleValue } from '@/lib/tiptap/ordered-list-style'

// Выставляет выравнивание на текущем абзаце/заголовке. updateAttributes для
// «неподходящего» типа — безопасный no-op, поэтому вызываем для обоих.
function setAlign(editor: Editor, align: TextAlignValue) {
  let chain = editor.chain().focus()
  for (const type of TEXT_ALIGN_TYPES) chain = chain.updateAttributes(type, { textAlign: align })
  chain.run()
}

// Короткая метка стиля нумерации для кнопки-переключателя.
const LIST_STYLE_LABEL: Record<OrderedListStyleValue, string> = {
  legal: '1.',
  alpha: 'a.',
  roman: 'i.',
}
const LIST_STYLE_TITLE: Record<OrderedListStyleValue, string> = {
  legal: 'Нумерация: 1., 1.1., 1.1.1. (нажмите, чтобы сменить)',
  alpha: 'Нумерация: a), b), c) (нажмите, чтобы сменить)',
  roman: 'Нумерация: i), ii), iii) (нажмите, чтобы сменить)',
}

function currentListStyle(editor: Editor): OrderedListStyleValue {
  const s = editor.getAttributes('orderedList').listStyle as OrderedListStyleValue | undefined
  return s && ORDERED_LIST_STYLES.includes(s) ? s : DEFAULT_ORDERED_LIST_STYLE
}

// Клик по переключателю: если списка нет — создаём нумерованный; если есть —
// меняем стиль на следующий по кругу.
function cycleOrderedStyle(editor: Editor) {
  if (!editor.isActive('orderedList')) {
    editor.chain().focus().toggleOrderedList().run()
    return
  }
  const cur = currentListStyle(editor)
  const next = ORDERED_LIST_STYLES[(ORDERED_LIST_STYLES.indexOf(cur) + 1) % ORDERED_LIST_STYLES.length]
  editor.chain().focus().updateAttributes('orderedList', { listStyle: next }).run()
}

// Цвета шрифта для пометок в договоре. Чёрный — «снять цвет» (базовый текст).
const TEXT_COLORS: Array<{ value: string | null; title: string; swatch: string }> = [
  { value: null,      title: 'Обычный (чёрный)', swatch: '#18181B' },
  { value: '#C81E1E', title: 'Красный',          swatch: '#C81E1E' },
  { value: '#1A7F37', title: 'Зелёный',          swatch: '#1A7F37' },
  { value: '#1D4ED8', title: 'Синий',            swatch: '#1D4ED8' },
]

const HIGHLIGHT_COLOR = '#FFF176' // жёлтая заливка выделенных строк

// Сетка выбора размера таблицы в поповере: максимум 10 строк × 10 столбцов
const TABLE_PICKER_ROWS = 10
const TABLE_PICKER_COLS = 10

const BTN =
  'h-[26px] min-w-[26px] px-[7px] rounded-[var(--radius-sm)] text-[12px] font-medium text-[var(--ink-3)] ' +
  'hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer ' +
  'data-[active=true]:bg-[var(--ink)] data-[active=true]:text-[var(--bg)]'

// Иконки выравнивания: набор горизонтальных линий с разной раскладкой
function AlignIcon({ variant }: { variant: 'left' | 'center' | 'right' | 'justify' }) {
  // x2 (правый край второй линии) варьируем, чтобы визуально читалось выравнивание
  const lines: Record<typeof variant, Array<[number, number]>> = {
    left:    [[2, 14], [2, 10], [2, 14], [2, 10]],
    center:  [[3, 13], [5, 11], [3, 13], [5, 11]],
    right:   [[2, 14], [6, 14], [2, 14], [6, 14]],
    justify: [[2, 14], [2, 14], [2, 14], [2, 14]],
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      {lines[variant].map(([x1, x2], i) => (
        <line key={i} x1={x1} y1={3.5 + i * 3} x2={x2} y2={3.5 + i * 3} />
      ))}
    </svg>
  )
}

// Иконка «вставить таблицу» — сетка 3×3
function TableIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <line x1="2" y1="6.2" x2="14" y2="6.2" />
      <line x1="2" y1="9.8" x2="14" y2="9.8" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
      <line x1="10" y1="2.5" x2="10" y2="13.5" />
    </svg>
  )
}

// Иконка «удалить таблицу» — корзина
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="3" y1="4.5" x2="13" y2="4.5" />
      <path d="M4.5 4.5 5 13.2a1 1 0 0 0 1 .8h4a1 1 0 0 0 1-.8l.5-8.7" />
      <path d="M6.3 4.5V3.2a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v1.3" />
    </svg>
  )
}

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  // Перерисовка при смене выделения/форматирования — TipTap сам не триггерит React
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!editor) return
    const rerender = () => setTick((t) => t + 1)
    editor.on('transaction', rerender)
    editor.on('selectionUpdate', rerender)
    return () => {
      editor.off('transaction', rerender)
      editor.off('selectionUpdate', rerender)
    }
  }, [editor])

  // Поповер «вставить таблицу»: сетка выбора размера (навёл мышь → клик → вставка)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableHover, setTableHover] = useState<{ rows: number; cols: number } | null>(null)
  const tablePickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tablePickerOpen) return
    const close = (e: MouseEvent) => {
      if (!tablePickerRef.current?.contains(e.target as Node)) setTablePickerOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTablePickerOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [tablePickerOpen])

  if (!editor) return null

  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    setTablePickerOpen(false)
    setTableHover(null)
  }

  const items: Array<{ id?: string; label: React.ReactNode; title: string; active: boolean; run: () => void } | 'sep'> = [
    { label: <b>Ж</b>, title: 'Жирный', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: <i>К</i>, title: 'Курсив', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    'sep',
    // Цвет шрифта: кружок-образец. Чёрный снимает цвет, остальные — красят.
    ...TEXT_COLORS.map((c) => ({
      label: (
        <span
          className="block w-[13px] h-[13px] rounded-full"
          style={{ background: c.swatch, border: '1px solid rgba(0,0,0,0.25)' }}
        />
      ),
      title: `Цвет текста: ${c.title}`,
      active: c.value ? editor.isActive('textStyle', { color: c.value }) : false,
      run: () => (c.value
        ? editor.chain().focus().setColor(c.value).run()
        : editor.chain().focus().unsetColor().run()),
    })),
    // Жёлтая заливка выделенного текста (повторное нажатие снимает)
    {
      label: (
        <span
          className="block w-[13px] h-[13px] rounded-[3px]"
          style={{ background: HIGHLIGHT_COLOR, border: '1px solid rgba(0,0,0,0.25)' }}
        />
      ),
      title: 'Выделить жёлтым (нажмите ещё раз, чтобы снять)',
      active: editor.isActive('highlight'),
      run: () => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT_COLOR }).run(),
    },
    'sep',
    { label: 'H2', title: 'Заголовок раздела', active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'H3', title: 'Подзаголовок', active: editor.isActive('heading', { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    'sep',
    { label: '•', title: 'Маркированный список', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Нумерованный список (Tab — вложенный пункт)', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    // Переключатель стиля нумерации активного списка: legal → alpha → roman
    { label: <span className="tabular-nums">{LIST_STYLE_LABEL[currentListStyle(editor)]}⇅</span>, title: LIST_STYLE_TITLE[currentListStyle(editor)], active: false, run: () => cycleOrderedStyle(editor) },
    'sep',
    { label: <AlignIcon variant="left" />,    title: 'По левому краю',  active: editor.isActive({ textAlign: 'left' }),    run: () => setAlign(editor, 'left') },
    { label: <AlignIcon variant="center" />,  title: 'По центру',       active: editor.isActive({ textAlign: 'center' }),  run: () => setAlign(editor, 'center') },
    { label: <AlignIcon variant="right" />,   title: 'По правому краю', active: editor.isActive({ textAlign: 'right' }),   run: () => setAlign(editor, 'right') },
    { label: <AlignIcon variant="justify" />, title: 'По ширине',       active: editor.isActive({ textAlign: 'justify' }), run: () => setAlign(editor, 'justify') },
    'sep',
    // ── Таблицы ──────────────────────────────────────────────────────────────
    // «Вставить таблицу» открывает сетку выбора размера (см. рендер ниже);
    // правка строк/столбцов — только когда курсор внутри таблицы, иначе тулбар
    // был бы захламлён неактивными кнопками.
    { id: 'insert-table', label: <TableIcon />, title: 'Вставить таблицу…', active: tablePickerOpen, run: () => setTablePickerOpen((v) => !v) },
    ...(editor.isActive('table')
      ? [
          { label: <span className="tabular-nums">+стр</span>, title: 'Добавить строку ниже', active: false, run: () => editor.chain().focus().addRowAfter().run() },
          { label: <span className="tabular-nums">−стр</span>, title: 'Удалить строку', active: false, run: () => editor.chain().focus().deleteRow().run() },
          { label: <span className="tabular-nums">+стлб</span>, title: 'Добавить столбец справа', active: false, run: () => editor.chain().focus().addColumnAfter().run() },
          { label: <span className="tabular-nums">−стлб</span>, title: 'Удалить столбец', active: false, run: () => editor.chain().focus().deleteColumn().run() },
          { label: '⧉', title: 'Объединить / разбить ячейки', active: false, run: () => editor.chain().focus().mergeOrSplit().run() },
          { label: <TrashIcon />, title: 'Удалить таблицу целиком', active: false, run: () => editor.chain().focus().deleteTable().run() },
        ]
      : []),
    'sep',
    { label: '↶', title: 'Отменить (Ctrl+Z)', active: false, run: () => editor.chain().focus().undo().run() },
    { label: '↷', title: 'Повторить (Ctrl+Shift+Z)', active: false, run: () => editor.chain().focus().redo().run() },
  ]

  return (
    <div className="flex items-center gap-[2px]">
      {items.map((b, i) =>
        b === 'sep' ? (
          <div key={`sep-${i}`} className="w-px h-[16px] bg-[var(--line)] mx-[3px]" />
        ) : b.id === 'insert-table' ? (
          // Кнопка «вставить таблицу» с поповером-сеткой: наводишь на нужный
          // размер (например 4×6), кликаешь — таблица вставляется с шапкой.
          <div key={b.title} ref={tablePickerRef} className="relative">
            <button
              type="button"
              title={b.title}
              data-active={b.active}
              className={BTN}
              onMouseDown={(e) => { e.preventDefault(); b.run() }}
            >
              {b.label}
            </button>
            {tablePickerOpen && (
              <div
                className="absolute top-full left-0 mt-[4px] z-50 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] p-[8px] shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
                // preventDefault — не отдавать фокус поповеру, выделение в
                // редакторе должно пережить выбор размера
                onMouseDown={(e) => e.preventDefault()}
              >
                <div
                  className="grid gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${TABLE_PICKER_COLS}, 14px)` }}
                  onMouseLeave={() => setTableHover(null)}
                >
                  {Array.from({ length: TABLE_PICKER_ROWS * TABLE_PICKER_COLS }, (_, idx) => {
                    const r = Math.floor(idx / TABLE_PICKER_COLS) + 1
                    const c = (idx % TABLE_PICKER_COLS) + 1
                    const hot = tableHover !== null && r <= tableHover.rows && c <= tableHover.cols
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`w-[14px] h-[14px] rounded-[2px] border cursor-pointer transition-colors ${
                          hot ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--surface-2)] border-[var(--line)]'
                        }`}
                        onMouseEnter={() => setTableHover({ rows: r, cols: c })}
                        onClick={() => insertTable(r, c)}
                      />
                    )
                  })}
                </div>
                <div className="mt-[6px] text-center text-[11px] text-[var(--ink-3)] tabular-nums">
                  {tableHover ? `${tableHover.rows} × ${tableHover.cols}` : 'Выберите размер'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            key={b.title}
            type="button"
            title={b.title}
            data-active={b.active}
            className={BTN}
            // preventDefault на mousedown — чтобы не терять выделение в редакторе
            onMouseDown={(e) => { e.preventDefault(); b.run() }}
          >
            {b.label}
          </button>
        ),
      )}
    </div>
  )
}
