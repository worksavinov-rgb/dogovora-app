'use client'

/**
 * EditorToolbar — мини-тулбар редактируемого предпросмотра.
 * Только то, что переживает экспорт в DOCX: жирный, курсив, заголовки, списки
 * (конвертер packages/shared переносит bold/italics/заголовки/списки).
 */

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

const BTN =
  'h-[26px] min-w-[26px] px-[7px] rounded-[var(--radius-sm)] text-[12px] font-medium text-[var(--ink-3)] ' +
  'hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer ' +
  'data-[active=true]:bg-[var(--ink)] data-[active=true]:text-[var(--bg)]'

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
