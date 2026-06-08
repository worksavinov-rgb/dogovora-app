/**
 * Файловое хранилище: бинарные файлы (DOCX, PDF, сканы) лежат в каталогах на диске,
 * в БД хранится только относительный путь (ключ) для связки.
 *
 * Базовый каталог берётся из env STORAGE_DIR (по умолчанию ./storage относительно
 * процесса). И Next.js API, и воркер запускаются из apps/web, поэтому каталог общий.
 * В production задавайте абсолютный путь (примонтированный volume).
 */
import { promises as fs } from 'fs'
import path from 'path'

const DEFAULT_DIR = 'storage'

function getBaseDir(): string {
  const dir = process.env['STORAGE_DIR']?.trim() || DEFAULT_DIR
  return path.resolve(process.cwd(), dir)
}

/**
 * Превращает логический ключ (например "versions/abc/formatted.docx") в абсолютный
 * путь внутри базового каталога. Защищает от path traversal ("../").
 */
function resolveKey(key: string): string {
  const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedKey) throw new Error('Storage key is empty')

  const base = getBaseDir()
  const target = path.resolve(base, normalizedKey)
  const rel = path.relative(base, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Invalid storage key: ${key}`)
  }
  return target
}

/** Записывает файл по ключу, создавая вложенные каталоги. Возвращает ключ и размер. */
export async function saveFile(key: string, data: Buffer): Promise<{ key: string; size: number }> {
  const target = resolveKey(key)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, data)
  return { key, size: data.byteLength }
}

/** Читает файл по ключу. Бросает, если файла нет. */
export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key))
}

/** Проверяет существование файла. */
export async function fileExists(key: string): Promise<boolean> {
  try {
    await fs.access(resolveKey(key))
    return true
  } catch {
    return false
  }
}

/** Удаляет файл. Молча игнорирует отсутствие файла. */
export async function deleteFile(key: string): Promise<void> {
  try {
    await fs.unlink(resolveKey(key))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/** Ключ файла, привязанного к версии документа. */
export function versionFileKey(versionId: string, filename: string): string {
  return `versions/${versionId}/${filename}`
}
