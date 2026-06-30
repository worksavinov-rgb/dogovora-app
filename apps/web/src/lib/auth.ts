import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

// Секрет ДОЛЖЕН быть задан в окружении. Никакого запасного значения в коде —
// иначе при незаданной переменной сервер работал бы на публичном секрете из
// исходников, и кто угодно смог бы подделать токен любого пользователя.
const JWT_SECRET: string = process.env['JWT_SECRET'] ?? ''
if (JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET не задан или короче 32 символов. Установите переменную окружения JWT_SECRET ' +
      '(случайная строка ≥ 32 символов) перед запуском.',
  )
}

const ACCESS_EXPIRES = '15m'
const REFRESH_EXPIRES = '30d'

export interface JWTPayload {
  userId: string
  email: string
}

export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES })
}

export function signRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_EXPIRES })
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload
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
