import type { GigachatCredentials } from './config/types'
import { gigachatFetch } from './gigachat-fetch'
import { GIGACHAT_MODEL_CATALOG, type GigachatModelOption } from './gigachat-model-hints'

// Реэкспорт чистых данных/подсказок — серверный код по-прежнему может брать их
// отсюда, но клиентский бандл (/admin/ai) импортит напрямую из gigachat-model-hints,
// чтобы не тянуть undici (node:net) в браузер.
export {
  GIGACHAT_MODEL_CATALOG,
  GIGACHAT_MODELS,
  GIGACHAT_TASK_MODEL_HINTS,
  POLZA_TASK_MODEL_HINTS,
  pickRecommendedModel,
  type GigachatModelOption,
} from './gigachat-model-hints'

type TokenCache = { token: string; expiresAtMs: number }
const tokenCaches = new Map<string, TokenCache>()

async function getToken(creds: GigachatCredentials): Promise<string> {
  const authUrl = creds.authUrl ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
  const scope = creds.scope ?? 'GIGACHAT_API_PERS'
  const cacheKey = creds.authKey.slice(0, 16)
  const cached = tokenCaches.get(cacheKey)
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token

  const res = await gigachatFetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${creds.authKey}`,
    },
    body: new URLSearchParams({ scope }),
  })
  if (!res.ok) throw new Error(`GigaChat auth failed: ${res.status}`)
  const json = await res.json() as { access_token?: string; expires_at?: number }
  if (!json.access_token) throw new Error('GigaChat auth: no access_token')
  const expiresAtMs = json.expires_at
    ? (json.expires_at > 10_000_000_000 ? json.expires_at : json.expires_at * 1000)
    : Date.now() + 25 * 60 * 1000
  tokenCaches.set(cacheKey, { token: json.access_token, expiresAtMs })
  return json.access_token
}

/** Проверяет, что API доступен (для кнопки «Проверить») */
export async function verifyGigachatApi(creds: GigachatCredentials): Promise<void> {
  const baseUrl = (creds.baseUrl ?? 'https://gigachat.devices.sberbank.ru/api/v1').replace(/\/+$/, '')
  const token = await getToken(creds)
  const res = await gigachatFetch(`${baseUrl}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GigaChat models failed: ${res.status}`)
}

/** Список из трёх чат-моделей для админки */
export async function getGigachatChatModels(creds?: GigachatCredentials): Promise<{
  models: GigachatModelOption[]
  source: 'api' | 'catalog'
}> {
  if (creds?.authKey) {
    try {
      await verifyGigachatApi(creds)
      return { models: GIGACHAT_MODEL_CATALOG, source: 'api' }
    } catch (err) {
      console.warn('[GigaChat] API недоступен, показываем каталог:', err)
    }
  }
  return { models: GIGACHAT_MODEL_CATALOG, source: 'catalog' }
}
