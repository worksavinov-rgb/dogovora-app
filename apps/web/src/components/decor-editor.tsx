'use client'

/**
 * DecorEditor — редактируемый блок слоя оформления (шапка договора и блок
 * реквизитов/подписей).
 *
 * Эти блоки — часть «листа», но не часть тела версии: они хранятся на документе
 * и сохраняются отдельно (PATCH /decor). Раньше здесь был простой
 * contentEditable, из-за чего к шапке нельзя было применить ни выравнивание, ни
 * жирный, ни цвет — тулбар работает с редактором, а не с голым DOM.
 *
 * Теперь это полноценный редактор с тем же набором расширений, что и тело
 * документа. При фокусе блок сообщает о себе наверх (onActivate), и общий
 * тулбар начинает править именно его.
 */

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { TIPTAP_EXTENSIONS } from '@/lib/tiptap/extensions'
import { sanitizeHtml, normalizeLegalHtml, layoutDivsToTables } from '@/lib/html-document'

interface DecorEditorProps {
  /** HTML блока оформления */
  html: string
  /** Подсказка при наведении («Шапка · оформление…») */
  hint: string
  /** Разрешено ли редактирование (в режиме просмотра — нет) */
  editable: boolean
  /** Блок получил фокус — общий тулбар должен переключиться на него */
  onActivate: (editor: Editor) => void
  /** Фокус ушёл — сохраняем содержимое */
  onSave: (html: string) => void
}

export function DecorEditor({ html, hint, editable, onActivate, onSave }: DecorEditorProps) {
  // Колбэки держим в ref, чтобы редактор не пересоздавался на каждый рендер
  // родителя. Присваиваем в эффекте, а не в теле рендера.
  const onSaveRef = useRef(onSave)
  const onActivateRef = useRef(onActivate)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { onActivateRef.current = onActivate }, [onActivate])

  // Санитайз только на входе: содержимое приходит из БД и от пользователя.
  // Ленивая инициализация — считаем один раз, а не на каждый рендер.
  const [initialContent] = useState(() => layoutDivsToTables(normalizeLegalHtml(sanitizeHtml(html))))

  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    content: initialContent,
    editable,
    immediatelyRender: false,
    onFocus: ({ editor }) => onActivateRef.current(editor),
    onBlur: ({ editor }) => onSaveRef.current(editor.getHTML()),
  })

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable)
  }, [editor, editable])

  // Внешнее обновление (перечитали слой оформления после сохранения на сервере).
  // Пока пользователь печатает — не трогаем, иначе прыгает курсор.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    const next = layoutDivsToTables(normalizeLegalHtml(sanitizeHtml(html)))
    if (editor.getHTML() !== next) editor.commands.setContent(next, { emitUpdate: false })
  }, [editor, html])

  if (!editor) return null

  return (
    <div className="group relative my-[4px]">
      <div
        className={[
          'document-viewer doc-content rounded-[4px] transition-shadow',
          editable ? 'cursor-text hover:ring-1 hover:ring-[var(--line-2)] focus-within:ring-1 focus-within:ring-[var(--accent)]' : '',
        ].join(' ')}
      >
        <EditorContent editor={editor} />
      </div>
      {editable && (
        <span className="absolute -top-[16px] right-0 hidden group-hover:block text-[10px] text-[var(--ink-4)] select-none pointer-events-none">
          {hint}
        </span>
      )}
    </div>
  )
}
