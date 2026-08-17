import { openaiComplete, openaiStream, openrouterDefaultHeaders, type OpenAIUsage } from './openai-compatible'
import { gigachatFetch } from './gigachat-fetch'
import { getActiveGigachatCredentials, getActiveProviderPolicy, getActiveRoute, recordAIUsage } from './config/runtime'
import type { AITask, OperatorSlug } from './tasks'
import type { GigachatCredentials, OpenAICompatibleCredentials } from './config/types'

const ENV_GIGACHAT_AUTH_URL = process.env['GIGACHAT_AUTH_URL'] ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
const ENV_GIGACHAT_BASE_URL = (process.env['GIGACHAT_BASE_URL'] ?? 'https://gigachat.devices.sberbank.ru/api/v1').replace(/\/+$/, '')
const ENV_GIGACHAT_SCOPE = process.env['GIGACHAT_SCOPE'] ?? 'GIGACHAT_API_PERS'
const ENV_GIGACHAT_AUTH_KEY = process.env['GIGACHAT_AUTH_KEY'] ?? ''

const DEFAULT_BASE: Record<'polza' | 'openrouter', string> = {
  polza: 'https://polza.ai/api/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

type AccessTokenCache = { token: string; expiresAtMs: number }
const tokenCaches = new Map<string, AccessTokenCache>()

function epochToMs(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return Date.now() + 25 * 60 * 1000
  return value > 10_000_000_000 ? value : value * 1000
}

function gigachatCreds(): GigachatCredentials {
  const active = getActiveGigachatCredentials() as GigachatCredentials | null
  return {
    authKey: active?.authKey || ENV_GIGACHAT_AUTH_KEY,
    scope: active?.scope || ENV_GIGACHAT_SCOPE,
    baseUrl: active?.baseUrl || ENV_GIGACHAT_BASE_URL,
    authUrl: active?.authUrl || ENV_GIGACHAT_AUTH_URL,
  }
}

async function getGigachatToken(creds: GigachatCredentials): Promise<string> {
  if (!creds.authKey) throw new Error('GigaChat authKey не настроен')
  const cacheKey = creds.authKey.slice(0, 16)
  const cached = tokenCaches.get(cacheKey)
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token

  const body = new URLSearchParams({ scope: creds.scope ?? ENV_GIGACHAT_SCOPE })
  const res = await gigachatFetch(creds.authUrl ?? ENV_GIGACHAT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${creds.authKey}`,
    },
    body,
  })
  if (!res.ok) {
    const details = await res.text()
    throw new Error(`GigaChat auth failed: ${res.status} ${details}`)
  }
  const json = await res.json() as { access_token?: string; expires_at?: number }
  if (!json.access_token) throw new Error('GigaChat auth response has no access_token')
  tokenCaches.set(cacheKey, { token: json.access_token, expiresAtMs: epochToMs(json.expires_at) })
  return json.access_token
}

export function resolveActiveOperator(task?: AITask): OperatorSlug {
  if (task) {
    const route = getActiveRoute(task)
    if (route?.operatorSlug) return route.operatorSlug
  }

  const fallbackTasks: AITask[] = ['generate', 'edit', 'chat', 'review', 'default']
  for (const t of fallbackTasks) {
    const route = getActiveRoute(t)
    if (route?.operatorSlug) return route.operatorSlug
  }

  const env = (process.env['AI_PROVIDER'] ?? 'mock').toLowerCase()
  if (env === 'polza') return 'polza'
  if (env === 'openrouter') return 'openrouter'
  if (env === 'gigachat') return 'gigachat'
  return 'mock'
}

function isOpenAICompatible(slug: OperatorSlug): slug is 'polza' | 'openrouter' {
  return slug === 'polza' || slug === 'openrouter'
}

function openaiCompatibleCreds(slug: 'polza' | 'openrouter', task?: AITask): OpenAICompatibleCredentials {
  if (task) {
    const route = getActiveRoute(task)
    if (route?.operatorSlug === slug) return route.credentials as OpenAICompatibleCredentials
  }
  for (const t of ['generate', 'edit', 'chat', 'review', 'default'] as const) {
    const route = getActiveRoute(t)
    if (route?.operatorSlug === slug) {
      return route.credentials as OpenAICompatibleCredentials
    }
  }
  if (slug === 'openrouter') {
    return {
      apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
      baseUrl: process.env['OPENROUTER_BASE_URL'] ?? DEFAULT_BASE.openrouter,
    }
  }
  return {
    apiKey: process.env['POLZA_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '',
    baseUrl: process.env['POLZA_BASE_URL'] ?? DEFAULT_BASE.polza,
  }
}

function trackUsage(usage?: OpenAIUsage | null): void {
  if (!usage) return
  recordAIUsage({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    costRub: usage.costRub,
  })
}

function parseUsageFromJson(json: unknown): OpenAIUsage {
  const usage = (json as { usage?: Record<string, unknown> })?.usage
  if (!usage) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const promptTokens = Number(usage.prompt_tokens ?? 0)
  const completionTokens = Number(usage.completion_tokens ?? 0)
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens)
  const costRub = usage.cost_rub != null ? Number(usage.cost_rub) : usage.cost != null ? Number(usage.cost) : undefined
  return { promptTokens, completionTokens, totalTokens, costRub }
}

function openaiCompatibleCallOptions(
  slug: 'polza' | 'openrouter',
  task: AITask,
  payload: Record<string, unknown>,
) {
  const creds = openaiCompatibleCreds(slug, task)
  const label = slug === 'openrouter' ? 'OPENROUTER_API_KEY' : 'POLZA_API_KEY'
  if (!creds.apiKey) throw new Error(`${label} не настроен`)
  const messages = payload.messages as Array<{ role: string; content: string }>
  return {
    baseUrl: creds.baseUrl ?? DEFAULT_BASE[slug],
    apiKey: creds.apiKey,
    model: String(payload.model ?? 'openai/gpt-4o-mini'),
    messages,
    max_tokens: payload.max_tokens as number | undefined,
    temperature: payload.temperature as number | undefined,
    providerPolicy: getActiveProviderPolicy(task),
    headers: slug === 'openrouter' ? openrouterDefaultHeaders() : undefined,
    extra: {
      repetition_penalty: payload.repetition_penalty,
      frequency_penalty: payload.frequency_penalty,
      presence_penalty: payload.presence_penalty,
    },
  }
}

export async function* streamCompletion(
  payload: Record<string, unknown>,
  task: AITask = 'default',
): AsyncGenerator<string> {
  const operator = resolveActiveOperator(task)
  if (operator === 'mock') {
    throw new Error('Mock provider не использует transport.streamCompletion напрямую')
  }

  if (isOpenAICompatible(operator)) {
    yield* openaiStream({
      ...openaiCompatibleCallOptions(operator, task, payload),
      onUsage: trackUsage,
    })
    return
  }

  const creds = gigachatCreds()
  const token = await getGigachatToken(creds)
  const baseUrl = (creds.baseUrl ?? ENV_GIGACHAT_BASE_URL).replace(/\/+$/, '')
  const response = await gigachatFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...payload, stream: true }),
  })

  if (!response.ok || !response.body) {
    const details = await response.text()
    throw new Error(`GigaChat stream failed: ${response.status} ${details}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let delimiterIndex = buffer.indexOf('\n\n')
    while (delimiterIndex !== -1) {
      const chunk = buffer.slice(0, delimiterIndex)
      buffer = buffer.slice(delimiterIndex + 2)
      delimiterIndex = buffer.indexOf('\n\n')
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
            usage?: Record<string, unknown>
          }
          if (parsed.usage) trackUsage(parseUsageFromJson(parsed))
          const tokenText =
            parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
          if (tokenText) yield tokenText
        } catch { /* skip */ }
      }
    }
  }
}

export async function completeCompletion(
  payload: Record<string, unknown>,
  task: AITask = 'default',
  retries = 4,
): Promise<string> {
  const operator = resolveActiveOperator(task)
  if (operator === 'mock') {
    throw new Error('Mock provider не использует transport.completeCompletion напрямую')
  }

  if (isOpenAICompatible(operator)) {
    const { content, usage } = await openaiComplete(
      openaiCompatibleCallOptions(operator, task, payload),
      retries,
    )
    trackUsage(usage)
    return content
  }

  const creds = gigachatCreds()
  const token = await getGigachatToken(creds)
  const baseUrl = (creds.baseUrl ?? ENV_GIGACHAT_BASE_URL).replace(/\/+$/, '')

  let response = await gigachatFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...payload, stream: false }),
  })

  let attemptsLeft = retries
  while (response.status === 429 && attemptsLeft > 0) {
    const delay = Math.pow(2, 4 - attemptsLeft) * 5000
    await new Promise((r) => setTimeout(r, delay))
    attemptsLeft--
    response = await gigachatFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...payload, stream: false }),
    })
  }

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`GigaChat complete failed: ${response.status} ${details}`)
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: Record<string, unknown>
  }
  trackUsage(parseUsageFromJson(json))
  return json.choices?.[0]?.message?.content ?? ''
}
