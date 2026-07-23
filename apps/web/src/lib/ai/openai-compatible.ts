import type { ProviderPolicy } from './config/types'

export interface OpenAIUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costRub?: number
}

export interface ChatCompletionOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
  providerPolicy?: ProviderPolicy
  extra?: Record<string, unknown>
  /** Доп. заголовки (например HTTP-Referer / X-Title для OpenRouter) */
  headers?: Record<string, string>
  onUsage?: (usage: OpenAIUsage) => void
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function buildBody(options: ChatCompletionOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream,
    ...(options.max_tokens != null ? { max_tokens: options.max_tokens } : {}),
    ...(options.temperature != null ? { temperature: options.temperature } : {}),
    ...options.extra,
  }
  if (options.providerPolicy) {
    body.provider = options.providerPolicy
  }
  return body
}

function authHeaders(options: ChatCompletionOptions, accept: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: accept,
    Authorization: `Bearer ${options.apiKey}`,
    ...options.headers,
  }
}

function parseUsage(json: unknown): OpenAIUsage {
  const usage = (json as { usage?: Record<string, unknown> })?.usage
  if (!usage) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  }
  const promptTokens = Number(usage.prompt_tokens ?? 0)
  const completionTokens = Number(usage.completion_tokens ?? 0)
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens)
  const costRub = usage.cost_rub != null ? Number(usage.cost_rub) : usage.cost != null ? Number(usage.cost) : undefined
  return { promptTokens, completionTokens, totalTokens, costRub }
}

export async function openaiComplete(options: ChatCompletionOptions, retries = 3): Promise<{
  content: string
  usage: OpenAIUsage
}> {
  const url = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`
  let response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(options, 'application/json'),
    body: JSON.stringify(buildBody(options, false)),
  })

  let attemptsLeft = retries
  while (response.status === 429 && attemptsLeft > 0) {
    const delay = Math.pow(2, retries - attemptsLeft) * 2000
    await new Promise((r) => setTimeout(r, delay))
    attemptsLeft--
    response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(options, 'application/json'),
      body: JSON.stringify(buildBody(options, false)),
    })
  }

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI-compatible API failed: ${response.status} ${details}`)
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: Record<string, unknown>
  }
  const content = json.choices?.[0]?.message?.content ?? ''
  return { content, usage: parseUsage(json) }
}

export async function* openaiStream(options: ChatCompletionOptions, retries = 3): AsyncGenerator<string> {
  const url = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`
  let response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(options, 'text/event-stream'),
    body: JSON.stringify(buildBody(options, true)),
  })

  let attemptsLeft = retries
  while (response.status === 429 && attemptsLeft > 0) {
    const delay = Math.pow(2, retries - attemptsLeft) * 2000
    await new Promise((r) => setTimeout(r, delay))
    attemptsLeft--
    response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(options, 'text/event-stream'),
      body: JSON.stringify(buildBody(options, true)),
    })
  }

  if (!response.ok || !response.body) {
    const details = await response.text()
    throw new Error(`OpenAI-compatible stream failed: ${response.status} ${details}`)
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
            choices?: Array<{ delta?: { content?: string } }>
            usage?: Record<string, unknown>
          }
          if (parsed.usage && options.onUsage) {
            options.onUsage(parseUsage(parsed))
          }
          const token = parsed.choices?.[0]?.delta?.content ?? ''
          if (token) yield token
        } catch {
          // skip malformed chunk
        }
      }
    }
  }
}

/** Проверка соединения и баланс Polza.ai */
export async function polzaGetBalance(apiKey: string): Promise<{ amount: string }> {
  const res = await fetch('https://polza.ai/api/v1/balance', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const details = await res.text()
    throw new Error(`Polza balance failed: ${res.status} ${details}`)
  }
  return res.json() as Promise<{ amount: string }>
}

export async function polzaListModels(apiKey: string, type = 'chat'): Promise<unknown[]> {
  const res = await fetch(`https://polza.ai/api/v1/models?type=${type}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const details = await res.text()
    throw new Error(`Polza models failed: ${res.status} ${details}`)
  }
  const json = await res.json() as { data?: unknown[] }
  return json.data ?? []
}

const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1'

export function openrouterDefaultHeaders(): Record<string, string> {
  const referer =
    process.env['OPENROUTER_HTTP_REFERER']
    ?? process.env['NEXTAUTH_URL']
    ?? 'https://app.dogodoc.ru'
  // Header values must be ByteString (ASCII/Latin-1) — кириллица в X-Title ломает fetch
  const title = process.env['OPENROUTER_APP_TITLE'] ?? 'Dogodok'
  return {
    'HTTP-Referer': referer,
    'X-Title': title.replace(/[^\x20-\x7E]/g, ''),
  }
}

/** Проверка ключа OpenRouter (GET /models) */
export async function openrouterVerify(
  apiKey: string,
  baseUrl = OPENROUTER_DEFAULT_BASE,
): Promise<void> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...openrouterDefaultHeaders(),
    },
  })
  if (!res.ok) {
    const details = await res.text()
    throw new Error(`OpenRouter verify failed: ${res.status} ${details}`)
  }
}

export async function openrouterListModels(
  apiKey: string,
  baseUrl = OPENROUTER_DEFAULT_BASE,
): Promise<Array<{ id: string; name?: string }>> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...openrouterDefaultHeaders(),
    },
  })
  if (!res.ok) {
    const details = await res.text()
    throw new Error(`OpenRouter models failed: ${res.status} ${details}`)
  }
  const json = await res.json() as { data?: Array<{ id: string; name?: string }> }
  return json.data ?? []
}
