'use client'

/**
 * DocumentViewer — стабильный рендер юридического договора через TipTap.
 *
 * Принимает HTML-контент (или Markdown для обратной совместимости).
 * TipTap парсит HTML, хранит в своём внутреннем формате и рендерит стабильно:
 * - заголовки, списки, таблицы, жирный/курсив
 * - реквизиты и подписи
 *
 * Предоплатная модель: контент всегда доступен для выделения и копирования.
 *
 * Режим editable: тот же движок, но с ручным редактированием (тулбар —
 * components/editor-toolbar.tsx). Синхронизация контента:
 * - ручной ввод → onUpdate(html) наверх, содержимое редактора НЕ трогаем
 *   (иначе курсор прыгает на каждом символе);
 * - внешнее изменение (ИИ-стрим, смена версии, восстановление черновика) —
 *   родитель инкрементирует externalContentKey → заменяем содержимое целиком.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlignClass } from '@/lib/tiptap/text-align-class'
import { OrderedListStyle } from '@/lib/tiptap/ordered-list-style'
import { isHtmlContent, sanitizeHtml, normalizeLegalHtml, maybePromoteHeadings, layoutDivsToTables } from '@/lib/html-document'

interface DocumentViewerProps {
  /** HTML или Markdown контент документа */
  content: string
  /** Ручное редактирование текста прямо в предпросмотре */
  editable?: boolean
  /** Ручная правка: отдаёт актуальный HTML наверх (только в editable) */
  onUpdate?: (html: string) => void
  /**
   * Сигнал «контент пришёл извне» (ИИ-стрим, смена версии, черновик):
   * при изменении ключа содержимое редактора заменяется на `content`.
   * Без ключа (или в read-only) контент применяется при каждом изменении `content`.
   */
  externalContentKey?: number
  /** Отдаёт экземпляр редактора (для тулбара) */
  onEditorReady?: (editor: Editor) => void
  /** Вызывается когда контент обработан и готов */
  onReady?: () => void
}

const TIPTAP_EXTENSIONS = [
  StarterKit,
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TextAlignClass,
  OrderedListStyle,
  // Цвет шрифта и жёлтая заливка — правки в документе видно глазом; конвертер
  // переносит их в DOCX (см. html-docx-converter: color / highlight).
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
]

export function DocumentViewer({ content, editable = false, onUpdate, externalContentKey, onEditorReady, onReady }: DocumentViewerProps) {
  // Тяжёлый пайплайн (sanitize→normalize→promote→layout) вызываем ЛЕНИВО — только
  // когда контент реально применяется в редактор, а не на каждый ререндер.
  // Раньше это был useMemo по `content`: в editable-режиме `content` меняется на
  // каждый ввод символа (onUpdate → setDocContent), и пайплайн гонялся вхолостую.
  const process = useCallback((raw: string): string => {
    if (!raw) return '<p></p>'
    if (isHtmlContent(raw)) {
      // maybePromoteHeadings достраивает заголовки для ранее загруженных документов;
      // layoutDivsToTables переводит блок реквизитов в таблицу 1×2 (TipTap не знает <div>).
      return layoutDivsToTables(normalizeLegalHtml(maybePromoteHeadings(sanitizeHtml(raw))))
    }
    return convertMarkdownSync(raw)
  }, [])

  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  // Начальный контент вычисляем один раз (не на каждый ререндер)
  const initialContentRef = useRef<string | null>(null)
  if (initialContentRef.current === null) initialContentRef.current = process(content)

  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    content: initialContentRef.current,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor, transaction }) => {
      // Только ручной ввод (docChanged); программный setContent не эхоём наверх
      if (transaction.docChanged && editor.isEditable) {
        onUpdateRef.current?.(editor.getHTML())
      }
      onReady?.()
    },
  })

  // Отдаём редактор наверх (тулбар)
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Переключение режима редактирования без пересоздания редактора
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable)
  }, [editor, editable])

  // Read-only: контент реагирует на каждое изменение `content` (стриминг генерации,
  // смена версии). В editable-режиме этот эффект молчит — там работает следующий.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editable) return
    const processed = process(content)
    if (editor.getHTML() !== processed) editor.commands.setContent(processed, { emitUpdate: false })
  }, [editor, content, editable, process])

  // Editable: внешнюю замену применяем ТОЛЬКО по externalContentKey (ИИ-стрим,
  // undo, восстановление черновика) — иначе курсор прыгал бы на каждом вводе.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editable) return
    if (isFirstRender.current) { isFirstRender.current = false; return }
    editor.commands.setContent(process(content), { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editable, externalContentKey])

  if (!editor) return null

  return (
    <div className="document-viewer" data-editable={editable || undefined}>
      <EditorContent editor={editor} />
    </div>
  )
}

// ─── Синхронная конвертация Markdown → HTML ───────────────────────────────────
// Для быстрого рендера без async. Полноценная конвертация через markdownToLegalHtml().

function convertMarkdownSync(markdown: string): string {
  if (!markdown) return '<p></p>'

  // Убираем %%REQS_TABLE%% маркеры — конвертируем в HTML-блок
  const reqsMatch = markdown.match(/\n*(%%REQS_TABLE%%[\s\S]*?%%END_REQS%%)\s*$/)
  const reqsBlock = reqsMatch ? reqsMatch[1] : null
  const md = reqsBlock
    ? markdown.slice(0, markdown.length - reqsMatch![0].length).trimEnd()
    : markdown

  // Конвертируем построчно
  const lines = md.split('\n')
  const htmlLines: string[] = []
  let inList = false
  let listType: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      if (inList) {
        htmlLines.push(listType === 'ol' ? '</ol>' : '</ul>')
        inList = false
        listType = null
      }
      continue
    }

    // Заголовки: **РАЗДЕЛ** или # Раздел
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      const text = trimmed.replace(/\*\*/g, '')
      htmlLines.push(`<h2>${escHtml(text)}</h2>`)
      continue
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      const level = (trimmed.match(/^#+/) as RegExpMatchArray)[0].length
      const text = trimmed.replace(/^#+\s+/, '')
      const tag = level <= 2 ? 'h2' : 'h3'
      htmlLines.push(`<${tag}>${escHtml(text)}</${tag}>`)
      continue
    }

    // Списки
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList || listType !== 'ul') {
        if (inList) htmlLines.push('</ol>')
        htmlLines.push('<ul>')
        inList = true
        listType = 'ul'
      }
      const text = trimmed.replace(/^[-*]\s+/, '')
      htmlLines.push(`<li>${inlineMarkdown(text)}</li>`)
      continue
    }

    // Обычный параграф
    if (inList) {
      htmlLines.push(listType === 'ol' ? '</ol>' : '</ul>')
      inList = false
      listType = null
    }
    htmlLines.push(`<p>${inlineMarkdown(trimmed)}</p>`)
  }

  if (inList) htmlLines.push(listType === 'ol' ? '</ol>' : '</ul>')

  let result = htmlLines.join('\n')

  // Добавляем реквизиты если были
  if (reqsBlock) {
    result += '\n' + convertRequisitesSync(reqsBlock)
  }

  return result || '<p></p>'
}

function inlineMarkdown(text: string): string {
  return escHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function convertRequisitesSync(reqsBlock: string): string {
  const inner = reqsBlock
    .replace(/^%%REQS_TABLE%%\s*/m, '')
    .replace(/\s*%%END_REQS%%\s*$/, '')
    .trim()

  const sepIdx = inner.indexOf('%%COL_SEP%%')
  if (sepIdx === -1) {
    return `<div class="doc-requisites"><div class="doc-requisites-col">${convertReqLines(inner)}</div></div>`
  }

  const col1 = inner.slice(0, sepIdx).trim()
  const col2 = inner.slice(sepIdx + '%%COL_SEP%%'.length).trim()
  return [
    '<div class="doc-requisites">',
    `<div class="doc-requisites-col">${convertReqLines(col1)}</div>`,
    `<div class="doc-requisites-col">${convertReqLines(col2)}</div>`,
    '</div>',
  ].join('')
}

function convertReqLines(md: string): string {
  return md.split('\n')
    .map(line => {
      const t = line.trim()
      if (!t) return ''
      const html = escHtml(t)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      return `<p>${html}</p>`
    })
    .filter(Boolean)
    .join('')
}
