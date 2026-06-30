import { getRedisClient } from '@/lib/redis-client'

// ─── Blocklist отозванных токенов ──────────────────────────────────────────────
// При логауте/ротации jti токена заносится сюда до момента его естественного
// истечения (TTL). verifyToken/getUserId проверяют список и отвергают отозванные
// токены. Это закрывает дыру «украденный access-токен живёт до истечения, и
// логаут его не убивает».
//
// Деградация: если Redis недоступен — используем in-memory фолбэк (для dev и
// одиночного инстанса). Проверка fail-open: при полном отказе хранилища токен
// считается не отозванным, чтобы не положить весь сервис. Окно риска ограничено
// сроком жизни access-токена (15 мин).

const PREFIX = 'revoked:'

// In-memory фолбэк: jti -> момент истечения (ms epoch).
const memStore = new Map<string, number>()

function memSweep() {
  const now = Date.now()
  for (const [jti, exp] of memStore) {
    if (exp <= now) memStore.delete(jti)
  }
}

/** Заносит jti в blocklist на `ttlSec` секунд. */
export async function revokeToken(jti: string, ttlSec: number): Promise<void> {
  if (ttlSec <= 0) return
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.set(`${PREFIX}${jti}`, '1', 'EX', ttlSec)
      return
    } catch {
      // переходим на in-memory
    }
  }
  memSweep()
  memStore.set(jti, Date.now() + ttlSec * 1000)
}

/** Проверяет, отозван ли jti. fail-open при отказе хранилища. */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const redis = getRedisClient()
  if (redis) {
    try {
      const exists = await redis.exists(`${PREFIX}${jti}`)
      return exists === 1
    } catch {
      // переходим на in-memory
    }
  }
  const exp = memStore.get(jti)
  if (exp === undefined) return false
  if (exp <= Date.now()) {
    memStore.delete(jti)
    return false
  }
  return true
}
