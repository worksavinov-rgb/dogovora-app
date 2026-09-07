/**
 * Извлечение простого текста из загруженного файла — для разбора реквизитов.
 *
 * Файл нигде не сохраняется: прочитали, вернули текст, забыли. На диск и в базу
 * от него не попадает ничего.
 */

import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'

export type FileKind = 'docx' | 'pdf' | 'txt'

/** Ошибка с текстом, который можно показать пользователю как есть. */
export class FileReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileReadError'
  }
}

export function detectKind(filename: string): FileKind | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'docx') return 'docx'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'txt') return 'txt'
  if (ext === 'doc') {
    // mammoth читает только .docx; старый бинарный .doc молча давал пустой текст.
    throw new FileReadError('Формат .doc не поддерживается. Пересохраните файл в Word как .docx.')
  }
  return null
}

/**
 * Ниже этого объёма текста считаем, что содержательного текстового слоя нет.
 * Порог не нулевой: у сканов в PDF нередко остаётся техническая подпись
 * программы-сканера, и по «длина > 0» скан не отличить от настоящего документа.
 */
const MIN_MEANINGFUL_CHARS = 40

export async function extractPlainText(buf: Buffer, kind: FileKind): Promise<string> {
  const text = await readByKind(buf, kind)

  if (text.trim().length < MIN_MEANINGFUL_CHARS) {
    throw new FileReadError(
      kind === 'pdf'
        ? 'Похоже, это скан: текста внутри файла нет, есть только изображение страницы. Попросите у контрагента файл в Word или заполните реквизиты вручную.'
        : 'В файле не нашлось текста. Заполните реквизиты вручную.',
    )
  }

  return text
}

async function readByKind(buf: Buffer, kind: FileKind): Promise<string> {
  try {
    if (kind === 'txt') return buf.toString('utf8')

    if (kind === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer: buf })
      return value
    }

    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: true })
    return Array.isArray(text) ? text.join('\n') : text
  } catch (e) {
    if (e instanceof FileReadError) throw e
    throw new FileReadError('Не удалось прочитать файл. Возможно, он повреждён или защищён паролем.')
  }
}
