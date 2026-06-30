import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const ACCESS_EXPIRES = '15m'
const REFRESH_EXPIRES = '30d'

// Секрет ДОЛЖЕН быть задан в окружении. Никакого запасного значения в коде —
// иначе при незаданной переменной сервер работал бы на публичном секрете из
// исходников, и кто угодно смог бы подделать токен любого пользователя.
//
// Проверку делаем ЛЕНИВО (при первом обращении в рантайме), а не на верхнем
// уровне модуля: иначе `next build` падает, т.к. во время сборки JWT_SECRET
// ещё не задан. Fail-fast сохраняется — первый же запрос к auth упадёт, если
// секрет не настроен.
let _cachedSecret: string | null = null
function getJwtSecret(): string {
  if (_cachedSecret) return _cachedSecret
  const secret = process.env['JWT_SECRET'] ?? ''
  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET не задан или короче 32 символов. Установите переменную окружения JWT_SECRET ' +
        '(случайная строка ≥ 32 символов) перед запуском.',
    )
  }
  _cachedSecret = secret
  return secret
}

export interface JWTPayload {
  userId: string
  email: string
  /** Уникальный id токена (для отзыва через blocklist). Есть у выданных токенов. */
  jti?: string
  /** Unix-время истечения (сек), заполняется jwt при verify/decode. */
  exp?: number
}

export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_EXPIRES, jwtid: randomUUID() })
}

export function signRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: REFRESH_EXPIRES, jwtid: randomUUID() })
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, getJwtSecret()) as JWTPayload
}

/**
 * Достаёт jti и оставшийся TTL (сек) из токена БЕЗ проверки подписи/срока.
 * Нужно для отзыва (logout): токен мог уже почти истечь — нам важен лишь jti и
 * сколько секунд держать его в blocklist. Возвращает null, если структура не та.
 */
export function getRevocationInfo(token: string): { jti: string; ttlSec: number } | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload | null
    if (!decoded?.jti) return null
    const nowSec = Math.floor(Date.now() / 1000)
    const ttlSec = decoded.exp ? decoded.exp - nowSec : 0
    return { jti: decoded.jti, ttlSec }
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Парсит токен из cookie-заголовка */
export function getTokenFromCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match?.[1] ?? null
}
