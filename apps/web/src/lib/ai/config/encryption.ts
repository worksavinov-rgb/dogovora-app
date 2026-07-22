import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12

function getEncryptionKey(): Buffer {
  const raw = process.env['AI_CREDENTIALS_ENCRYPTION_KEY'] ?? process.env['JWT_SECRET'] ?? ''
  if (raw.length < 16) {
    throw new Error(
      'AI_CREDENTIALS_ENCRYPTION_KEY (или JWT_SECRET ≥ 32 символов) нужен для шифрования ключей ИИ в БД',
    )
  }
  return createHash('sha256').update(raw).digest()
}

/** Шифрует JSON credentials для хранения в БД. */
export function encryptCredentials(data: Record<string, unknown>): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const plaintext = JSON.stringify(data)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Расшифровывает credentials из БД. */
export function decryptCredentials<T extends Record<string, unknown>>(encoded: string): T {
  if (!encoded) return {} as T
  const key = getEncryptionKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + 16)
  const encrypted = buf.subarray(IV_LEN + 16)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8')) as T
}

/** Маскирует секрет для отображения в UI: sk-abc...xyz */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}
