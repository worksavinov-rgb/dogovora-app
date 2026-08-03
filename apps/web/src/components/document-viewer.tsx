'use client'

/**
 * DocumentViewer — стабильный рендер юридического договора через TipTap.
 *
 * Принимает HTML-контент (или Markdown для обратной совместимости).
 * TipTap парсит HTML, хранит в своём внутреннем формате и рендерит стабильно:
 * - заголовки, списки, таблицы, жирный/курсив
 * - реквизиты и подписи
 * - копирование (если canCopy = true)
 *
 * НЕ редактируемый — editable={false}.
 * Будущий ручной редактор: поменять editable на true.
 */

import { useEffect, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { isHtmlContent, markdownToLegalHtml, sanitizeHtml, normalizeLegalHtml, maybePromoteHeadings, layoutDivsToTables } from '@/lib/html-document'

interface DocumentViewerProps {
  /** HTML или Markdown контент документа */
  content: string
  /** Разрешено ли копирование (после покупки) */
  canCopy?: boolean
  /** Вызывается когда контент обработан и готов */
  onReady?: () => void
}

const TIPTAP_EXTENSIONS = [
  StarterKit,
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
]

export function DocumentViewer({ content, canCopy = false, onReady }: DocumentViewerProps) {
  // Конвертируем контент в HTML (с кэшированием)
  const htmlContent = useMemo(() => {
    if (!content) return '<p></p>'

    if (isHtmlContent(content)) {
      // maybePromoteHeadings достраивает заголовки для ранее загруженных документов,
      // у которых их нет (на лету, не меняя оригинал). Сгенерированные и новые
      // загрузки уже с заголовками — их не трогает.
      // layoutDivsToTables: TipTap не знает тега <div> и разворачивал блок реквизитов
      // в один столбик — переводим его в таблицу 1×2, её редактор сохраняет.
      return layoutDivsToTables(normalizeLegalHtml(maybePromoteHeadings(sanitizeHtml(content))))
    }

    // Старый Markdown — конвертируем синхронно через inline-замены
    // (полная асинхронная миграция выполняется отдельно)
    return convertMarkdownSync(content)
  }, [content])

  const editor = useEditor({
    extensions: TIPTAP_EXTENSIONS,
    content: htmlContent,
    editable: false,
    immediatelyRender: false,
    onUpdate: () => {
      onReady?.()
    },
  })

  // Обновляем контент при изменении
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(htmlContent)
    }
  }, [editor, htmlContent])

  if (!editor) return null

  return (
    <div
      className="document-viewer"
      style={{ userSelect: canCopy ? 'text' : 'none' }}
      onCopy={!canCopy ? (e) => e.preventDefault() : undefined}
    >
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
  let md = reqsBlock
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
