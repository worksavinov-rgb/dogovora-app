import Redis from 'ioredis'

// ─── Rate limiter ──────────────────────────────────────────────────────────────
// Скользящее окно с фиксированным интервалом (fixed window).
// Использует Redis, если задан REDIS_URL; иначе — in-memory фолбэк (для dev и
// одиночного инстанса). Применяется на чувствительных эндпоинтах (login, register)
// для защиты от брутфорса паролей и перебора промокодов.

let _redis: Redis | null = null
let _redisDisabled = false

function getRedis(): Redis | null {
  if (_redisDisabled) return null
  if (_redis) return _redis
  const url = process.env['REDIS_URL']
  if (!url) {
    _redisDisabled = true
    return null
  }
  try {
    _redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false })
    _redis.on('error', () => {
      // При сбое Redis не роняем запросы — переходим на in-memory фолбэк.
      _redisDisabled = true
    })
    return _redis
  } catch {
    _redisDisabled = true
    return null
  }
}

// In-memory фолбэк: счётчики попыток в памяти процесса.
const memStore = new Map<string, { count: number; resetAt: number }>()

function memHit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const entry = memStore.get(key)
  if (!entry || entry.resetAt <= now) {
    memStore.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 }
  }
  entry.count += 1
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { allowed: true, remaining: limit - entry.count, retryAfterSec: 0 }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

/**
 * Регистрирует попытку для ключа `key` и сообщает, не превышен ли лимит.
 * @param key уникальный идентификатор (например `login:<ip>`)
 * @param limit максимум попыток за окно
 * @param windowMs длина окна в миллисекундах
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) return memHit(key, limit, windowMs)

  try {
    const redisKey = `rl:${key}`
    const count = await redis.incr(redisKey)
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs)
    }
    if (count > limit) {
      const ttl = await redis.pttl(redisKey)
      return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((ttl > 0 ? ttl : windowMs) / 1000) }
    }
    return { allowed: true, remaining: limit - count, retryAfterSec: 0 }
  } catch {
    // Redis отвалился во время запроса — мягко переходим на in-memory.
    return memHit(key, limit, windowMs)
  }
}

/** Достаёт IP клиента из заголовков (за nginx / прокси). */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown'
  return req.headers.get('x-real-ip')?.trim() ?? 'unknown'
}
