// Общие утилиты для тестов DOCX-конвейера: распаковка документа и извлечение текста.
import JSZip from 'jszip'

/** Достаёт word/document.xml из DOCX-буфера (DOCX — это zip-архив). */
export async function readDocumentXml(docx: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(docx)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('В DOCX отсутствует word/document.xml')
  return entry.async('string')
}

/** Раскодирует XML-сущности (docx экранирует только базовые). */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Плоский текст из document.xml: содержимое всех <w:t>, пробелы нормализованы. */
export function docxPlainText(documentXml: string): string {
  const parts: string[] = []
  // (?:\s[^>]*)? — матчим ровно <w:t> и <w:t xml:…>, но НЕ <w:tblPr> и прочие теги на «t»
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(documentXml)) !== null) parts.push(decodeXmlEntities(m[1] ?? ''))
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Плоский текст исходного HTML: без тегов, с раскодированными сущностями. */
export function htmlPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Текст без пробелов — устойчивое сравнение длин (конвертер нормализует пробелы). */
export function compact(s: string): string {
  return s.replace(/\s+/g, '')
}
