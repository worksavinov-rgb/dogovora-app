import { createHash } from 'crypto'

/** Значение примитивно (участвует в подписи)? Вложенные объекты/массивы — нет. */
function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function stringify(v: string | number | boolean): string {
  return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)
}

/**
 * Подпись запроса/нотификации Т-Банка.
 * Алгоритм: берём корневые примитивные поля (кроме Token), добавляем Password,
 * сортируем по ключу, конкатенируем ТОЛЬКО значения, SHA-256 (UTF-8), hex.
 */
export function signToken(params: Record<string, unknown>, password: string): string {
  const pairs: [string, string][] = []
  for (const [key, value] of Object.entries(params)) {
    if (key === 'Token') continue
    if (!isPrimitive(value)) continue // Receipt, DATA и прочие объекты/массивы исключаются
    pairs.push([key, stringify(value)])
  }
  pairs.push(['Password', password])
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const concatenated = pairs.map(([, v]) => v).join('')
  return createHash('sha256').update(concatenated, 'utf8').digest('hex')
}

/** Проверка подписи нотификации: сверяем пересчитанный хеш с body.Token. */
export function verifyToken(body: Record<string, unknown>, password: string): boolean {
  const provided = typeof body.Token === 'string' ? body.Token.toLowerCase() : ''
  if (!provided) return false
  return signToken(body, password) === provided
}
