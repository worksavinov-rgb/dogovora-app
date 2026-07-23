import type { GigachatCredentials } from './config/types'

export interface GigachatModelOption {
  id: string
  name: string
  description?: string
}

/** Три актуальные чат-модели GigaChat 2.
 *  description — наши подсказки «для чего в Договоре», не официальные названия Сбера.
 */
export const GIGACHAT_MODEL_CATALOG: GigachatModelOption[] = [
  {
    id: 'GigaChat-2',
    name: 'GigaChat 2 Lite',
    description: 'рекомендуем: чат, орфография',
  },
  {
    id: 'GigaChat-2-Pro',
    name: 'GigaChat 2 Pro',
    description: 'рекомендуем: правки, извлечение реквизитов',
  },
  {
    id: 'GigaChat-2-Max',
    name: 'GigaChat 2 Max',
    description: 'рекомендуем: генерация, проверка рисков',
  },
]

type TokenCache = { token: string; expiresAtMs: number }
const tokenCaches = new Map<string, TokenCache>()

async function getToken(creds: GigachatCredentials): Promise<string> {
  const authUrl = creds.authUrl ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
  const scope = creds.scope ?? 'GIGACHAT_API_PERS'
  const cacheKey = creds.authKey.slice(0, 16)
  const cached = tokenCaches.get(cacheKey)
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token

  const res = await fetch(authUrl, {
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
  const res = await fetch(`${baseUrl}/models`, {
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

export const GIGACHAT_MODELS = GIGACHAT_MODEL_CATALOG.map((m) => m.id)

/** Рекомендуемая модель GigaChat по задаче */
export const GIGACHAT_TASK_MODEL_HINTS: Record<string, string> = {
  generate: 'GigaChat-2-Max',
  review: 'GigaChat-2-Max',
  analyze_upload: 'GigaChat-2-Max',
  review_fallback: 'GigaChat-2-Max',
  quick_analysis: 'GigaChat-2-Pro',
  edit: 'GigaChat-2-Pro',
  extract_parties: 'GigaChat-2-Pro',
  chat: 'GigaChat-2',
  spelling: 'GigaChat-2',
  default: 'GigaChat-2-Max',
}

/** Рекомендуемые модели Polza по задаче (если есть в каталоге) */
export const POLZA_TASK_MODEL_HINTS: Record<string, string[]> = {
  generate: ['anthropic/claude-sonnet-4-5', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
  review: ['anthropic/claude-sonnet-4-5', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
  analyze_upload: ['anthropic/claude-sonnet-4-5', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
  review_fallback: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
  quick_analysis: ['openai/gpt-4o', 'openai/gpt-4o-mini'],
  edit: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'],
  extract_parties: ['openai/gpt-4o', 'openai/gpt-4o-mini'],
  chat: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
  spelling: ['openai/gpt-4o-mini'],
  default: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
}

export function pickRecommendedModel(
  operatorSlug: string,
  task: string,
  available: Array<{ id: string }>,
): string {
  if (available.length === 0) return ''
  if (operatorSlug === 'gigachat') {
    const hint = GIGACHAT_TASK_MODEL_HINTS[task]
    if (hint && available.some((m) => m.id === hint)) return hint
  }
  if (operatorSlug === 'polza' || operatorSlug === 'openrouter') {
    const hints = POLZA_TASK_MODEL_HINTS[task] ?? []
    for (const id of hints) {
      if (available.some((m) => m.id === id)) return id
    }
  }
  return available[0]?.id ?? ''
}
