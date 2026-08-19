'use client'

/**
 * EditorToolbar — мини-тулбар редактируемого предпросмотра.
 * Только то, что переживает экспорт в DOCX: жирный, курсив, заголовки, списки
 * (конвертер packages/shared переносит bold/italics/заголовки/списки).
 */

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TEXT_ALIGN_TYPES, type TextAlignValue } from '@/lib/tiptap/text-align-class'

// Выставляет выравнивание на текущем абзаце/заголовке. updateAttributes для
// «неподходящего» типа — безопасный no-op, поэтому вызываем для обоих.
function setAlign(editor: Editor, align: TextAlignValue) {
  let chain = editor.chain().focus()
  for (const type of TEXT_ALIGN_TYPES) chain = chain.updateAttributes(type, { textAlign: align })
  chain.run()
}

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

  if (!editor) return null

  const items: Array<{ label: React.ReactNode; title: string; active: boolean; run: () => void } | 'sep'> = [
    { label: <b>Ж</b>, title: 'Жирный', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: <i>К</i>, title: 'Курсив', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    'sep',
    { label: 'H2', title: 'Заголовок раздела', active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'H3', title: 'Подзаголовок', active: editor.isActive('heading', { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    'sep',
    { label: '•', title: 'Маркированный список', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Нумерованный список', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    'sep',
    { label: <AlignIcon variant="left" />,    title: 'По левому краю',  active: editor.isActive({ textAlign: 'left' }),    run: () => setAlign(editor, 'left') },
    { label: <AlignIcon variant="center" />,  title: 'По центру',       active: editor.isActive({ textAlign: 'center' }),  run: () => setAlign(editor, 'center') },
    { label: <AlignIcon variant="right" />,   title: 'По правому краю', active: editor.isActive({ textAlign: 'right' }),   run: () => setAlign(editor, 'right') },
    { label: <AlignIcon variant="justify" />, title: 'По ширине',       active: editor.isActive({ textAlign: 'justify' }), run: () => setAlign(editor, 'justify') },
    'sep',
    { label: '↶', title: 'Отменить (Ctrl+Z)', active: false, run: () => editor.chain().focus().undo().run() },
    { label: '↷', title: 'Повторить (Ctrl+Shift+Z)', active: false, run: () => editor.chain().focus().redo().run() },
  ]

  return (
    <div className="flex items-center gap-[2px]">
      {items.map((b, i) =>
        b === 'sep' ? (
          <div key={`sep-${i}`} className="w-px h-[16px] bg-[var(--line)] mx-[3px]" />
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
