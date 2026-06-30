import { getRedisClient } from '@/lib/redis-client'

// ─── Блокировка аккаунта при подборе пароля ─────────────────────────────────────
// IP-rate-limit обходится через ботнет (много разных IP на один аккаунт).
// Здесь — лимит на сам аккаунт (по email): после MAX_FAILURES неудачных входов
// подряд аккаунт временно блокируется на LOCKOUT_SEC, независимо от IP.
// Успешный вход сбрасывает счётчик.
//
// Компромисс: возможен временный lockout-DoS (злоумышленник спамит чужой email
// неверными паролями и блокирует вход жертве). Поэтому блокировка КОРОТКАЯ и
// временная, плюс уже работает IP-rate-limit. Это стандартный баланс.

const MAX_FAILURES = 5
const WINDOW_SEC = 15 * 60 // окно подсчёта неудач
const LOCKOUT_SEC = 15 * 60 // длительность блокировки

const FAIL_PREFIX = 'loginfail:'
const LOCK_PREFIX = 'loginlock:'

// In-memory фолбэк.
const memFails = new Map<string, { count: number; resetAt: number }>()
const memLocks = new Map<string, number>() // email -> момент снятия блокировки (ms)

function norm(email: string): string {
  return email.trim().toLowerCase()
}

export interface LockStatus {
  locked: boolean
  retryAfterSec: number
}

/** Проверяет, заблокирован ли аккаунт сейчас. */
export async function checkLoginLock(email: string): Promise<LockStatus> {
  const key = norm(email)
  const redis = getRedisClient()
  if (redis) {
    try {
      const ttl = await redis.ttl(`${LOCK_PREFIX}${key}`)
      if (ttl > 0) return { locked: true, retryAfterSec: ttl }
      return { locked: false, retryAfterSec: 0 }
    } catch {
      // переходим на in-memory
    }
  }
  const until = memLocks.get(key)
  if (until && until > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((until - Date.now()) / 1000) }
  }
  if (until) memLocks.delete(key)
  return { locked: false, retryAfterSec: 0 }
}

/** Фиксирует неудачный вход. При достижении порога — ставит блокировку. */
export async function recordLoginFailure(email: string): Promise<void> {
  const key = norm(email)
  const redis = getRedisClient()
  if (redis) {
    try {
      const count = await redis.incr(`${FAIL_PREFIX}${key}`)
      if (count === 1) await redis.expire(`${FAIL_PREFIX}${key}`, WINDOW_SEC)
      if (count >= MAX_FAILURES) {
        await redis.set(`${LOCK_PREFIX}${key}`, '1', 'EX', LOCKOUT_SEC)
        await redis.del(`${FAIL_PREFIX}${key}`)
      }
      return
    } catch {
      // переходим на in-memory
    }
  }
  const now = Date.now()
  const entry = memFails.get(key)
  if (!entry || entry.resetAt <= now) {
    memFails.set(key, { count: 1, resetAt: now + WINDOW_SEC * 1000 })
    return
  }
  entry.count += 1
  if (entry.count >= MAX_FAILURES) {
    memLocks.set(key, now + LOCKOUT_SEC * 1000)
    memFails.delete(key)
  }
}

/** Сбрасывает счётчик неудач и блокировку (вызывать при успешном входе). */
export async function resetLoginFailures(email: string): Promise<void> {
  const key = norm(email)
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.del(`${FAIL_PREFIX}${key}`, `${LOCK_PREFIX}${key}`)
      return
    } catch {
      // переходим на in-memory
    }
  }
  memFails.delete(key)
  memLocks.delete(key)
}
