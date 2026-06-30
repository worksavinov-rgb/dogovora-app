import Redis from 'ioredis'

// ─── Общий Redis-клиент ────────────────────────────────────────────────────────
// Один ленивый экземпляр на процесс для rate-limit и blocklist токенов.
// Если REDIS_URL не задан или Redis недоступен — возвращаем null, и вызывающий
// код мягко деградирует (см. rate-limit.ts / token-store.ts).

let _redis: Redis | null = null
let _disabled = false

export function getRedisClient(): Redis | null {
  if (_disabled) return null
  if (_redis) return _redis
  const url = process.env['REDIS_URL']
  if (!url) {
    _disabled = true
    return null
  }
  try {
    _redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false })
    _redis.on('error', () => {
      // Не роняем запросы при сбое Redis — переходим в режим деградации.
      _disabled = true
    })
    return _redis
  } catch {
    _disabled = true
    return null
  }
}
