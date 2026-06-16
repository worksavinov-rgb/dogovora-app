/**
 * doc-format.ts
 * Единый модуль конвертации форматов документов.
 *
 * Canonical storage format: Markdown (с GFM-таблицами)
 *
 * markdownToHtml  — для предпросмотра (сервер и клиент)
 * htmlToMarkdown  — для загруженных Word-файлов (mammoth → markdown)
 */

import { marked, type Tokens } from 'marked'

// ─── Настройка marked ─────────────────────────────────────────────────────────

const renderer = new marked.Renderer()

// Таблицы — с классом для CSS-стилей
renderer.table = ({ header, rows }: Tokens.Table) => {
  const headHtml = header
    .map((h) => `<th>${h.tokens.map((t) => ('text' in t ? t.text : '')).join('')}</th>`)
    .join('')

  const bodyHtml = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${cell.tokens.map((t) => ('text' in t ? t.text : '')).join('')}</td>`)
          .join('')}</tr>`
    )
    .join('')

  return `<table class="doc-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`
}

// Заголовки — сохраняем текст, без лишних id
renderer.heading = ({ text, depth }: Tokens.Heading) => {
  return `<h${depth}>${text}</h${depth}>\n`
}

// Параграфы
renderer.paragraph = ({ text }: Tokens.Paragraph) => {
  return `<p>${text}</p>\n`
}

marked.setOptions({ renderer })

/**
 * Markdown (GFM с таблицами) → HTML
 * Используется для предпросмотра AI-сгенерированного контента.
 */
export function markdownToHtml(markdown: string): string {
  // Вырезаем %%REQS_TABLE%%...%%END_REQS%% — обрабатывается отдельно в DocumentRenderer
  const withoutReqs = markdown.replace(/%%REQS_TABLE%%[\s\S]*?%%END_REQS%%/g, '%%REQS_PLACEHOLDER%%')
  const html = marked.parse(withoutReqs) as string
  return html.replace(/%%REQS_PLACEHOLDER%%/g, markdown.match(/%%REQS_TABLE%%[\s\S]*?%%END_REQS%%/)?.[0] ?? '')
}

/**
 * HTML (из mammoth) → Markdown
 * Используется при загрузке Word-файлов чтобы хранить в едином формате.
 * Выполняется только на клиенте (browser-only).
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import('turndown')).default
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  })

  // Таблицы — turndown умеет конвертировать по умолчанию
  // Добавляем правило для ячеек с переносами строк
  td.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement(content: string) {
      return ` ${content.replace(/\n/g, ' ').trim()} |`
    },
  })

  return td.turndown(html)
}
