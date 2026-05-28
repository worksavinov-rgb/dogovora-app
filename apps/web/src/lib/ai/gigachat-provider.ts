import { z } from 'zod'
import type { AIMessage, AIProvider, AISettings, ReviewResult } from './types'

const GIGACHAT_AUTH_URL = process.env['GIGACHAT_AUTH_URL'] ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
const GIGACHAT_BASE_URL = (process.env['GIGACHAT_BASE_URL'] ?? 'https://gigachat.devices.sberbank.ru/api/v1').replace(/\/+$/, '')
const GIGACHAT_SCOPE = process.env['GIGACHAT_SCOPE'] ?? 'GIGACHAT_API_PERS'
const GIGACHAT_MODEL = process.env['GIGACHAT_MODEL'] ?? 'GigaChat-2'
const GIGACHAT_AUTH_KEY = process.env['GIGACHAT_AUTH_KEY'] ?? ''

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  issues: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      severity: z.enum(['risk', 'warning', 'ok']),
      title: z.string().min(1),
      description: z.string().min(1),
      clause: z.string().min(1),
    }),
  ),
})

type AccessTokenCache = {
  token: string
  expiresAtMs: number
}

let tokenCache: AccessTokenCache | null = null

function ensureGigachatConfig() {
  if (!GIGACHAT_AUTH_KEY) {
    throw new Error('GIGACHAT_AUTH_KEY is required when AI_PROVIDER=gigachat')
  }
}

function epochToMs(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return Date.now() + 25 * 60 * 1000
  // Некоторые ответы приходят в секундах, некоторые в миллисекундах.
  return value > 10_000_000_000 ? value : value * 1000
}

async function getAccessToken(): Promise<string> {
  ensureGigachatConfig()

  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.token
  }

  const body = new URLSearchParams({ scope: GIGACHAT_SCOPE })
  const res = await fetch(GIGACHAT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${GIGACHAT_AUTH_KEY}`,
    },
    body,
  })

  if (!res.ok) {
    const details = await res.text()
    throw new Error(`GigaChat auth failed: ${res.status} ${details}`)
  }

  const json = await res.json() as { access_token?: string; expires_at?: number }
  if (!json.access_token) throw new Error('GigaChat auth response has no access_token')

  tokenCache = {
    token: json.access_token,
    expiresAtMs: epochToMs(json.expires_at),
  }

  return json.access_token
}

async function chatCompletions(payload: Record<string, unknown>, stream = false): Promise<Response> {
  const token = await getAccessToken()

  return fetch(`${GIGACHAT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
}

function buildSystemPrompt(settings: AISettings): string {
  return [
    'Ты юридический помощник для подготовки договоров на русском языке.',
    'Пиши чётко, практично и без воды.',
    `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90.`,
    `Целевой объём текста: примерно ${settings.targetSize} знаков.`,
    settings.customInstruction ? `Дополнительная инструкция: ${settings.customInstruction}` : '',
  ].filter(Boolean).join('\n')
}

function toGigachatMessages(messages: AIMessage[], settings: AISettings, documentText: string) {
  const normalized = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
  const systemParts = [buildSystemPrompt(settings)]
  if (documentText) {
    systemParts.push(`Текст документа для контекста:\n${documentText}`)
  }

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    ...normalized,
  ]
}

async function* streamText(payload: Record<string, unknown>): AsyncGenerator<string> {
  const response = await chatCompletions({ ...payload, stream: true }, true)
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

      const lines = chunk.split(/\r?\n/)
      for (const line of lines) {
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') return

        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }

        const token = (parsed as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> })
          ?.choices?.[0]?.delta?.content
          ?? (parsed as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content
          ?? ''

        if (token) yield token
      }
    }
  }
}

async function completeText(payload: Record<string, unknown>): Promise<string> {
  const response = await chatCompletions({ ...payload, stream: false })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`GigaChat completion failed: ${response.status} ${details}`)
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }

  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1)

  return text
}

function normalizeReview(raw: unknown): ReviewResult {
  const parsed = reviewSchema.parse(raw)
  const issues = parsed.issues.map((issue) => ({
    id: String(issue.id),
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    clause: issue.clause,
  }))

  return {
    score: Math.round(parsed.score),
    summary: parsed.summary,
    issues,
    riskCount: issues.filter((i) => i.severity === 'risk').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    okCount: issues.filter((i) => i.severity === 'ok').length,
  }
}

export const gigachatProvider: AIProvider = {
  async *chat(messages: AIMessage[], settings: AISettings, documentText: string) {
    const payload = {
      model: GIGACHAT_MODEL,
      messages: toGigachatMessages(messages, settings, documentText),
      max_tokens: 1500,
      repetition_penalty: 1,
      temperature: 0.4,
    }

    yield* streamText(payload)
  },

  async *editDocument(documentText: string, instruction: string, settings: AISettings) {
    const systemPrompt = [
      'Ты юридический помощник. Твоя задача — применить изменения к тексту договора.',
      'ВАЖНО: В ответе верни ТОЛЬКО полный обновлённый текст договора. Без пояснений, без markdown, без преамбулы.',
      'Сохрани структуру и все разделы оригинала, применив только запрошенные изменения.',
      `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90.`,
      settings.customInstruction ? `Дополнительная инструкция: ${settings.customInstruction}` : '',
    ].filter(Boolean).join('\n')

    const userMessage = [
      `Инструкция по редактированию: ${instruction}`,
      '',
      'Текущий текст договора:',
      documentText || '(документ пуст — создай новый договор согласно инструкции)',
    ].join('\n')

    const payload = {
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
      repetition_penalty: 1,
      temperature: 0.3,
    }

    yield* streamText(payload)
  },

  async review(documentText: string, settings: AISettings): Promise<ReviewResult> {
    const prompt = [
      'Проверь договор на юридические риски и верни только JSON.',
      'Формат JSON:',
      '{"score":72,"summary":"...","issues":[{"id":"1","severity":"risk|warning|ok","title":"...","description":"...","clause":"п. 3.2"}]}',
      'Ограничения:',
      '- score: 0..100',
      '- issues: от 3 до 12 пунктов',
      '- severity только risk, warning, ok',
      '',
      `Уровень защиты: ${settings.protectionLevel}/90`,
      `Целевой объём: ${settings.targetSize} знаков`,
      settings.customInstruction ? `Доп. инструкция: ${settings.customInstruction}` : '',
      '',
      'Текст договора:',
      documentText || '(пустой текст документа)',
    ].filter(Boolean).join('\n')

    const content = await completeText({
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: 'Ты юрист-аудитор договоров. Возвращай только валидный JSON без markdown.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1800,
      repetition_penalty: 1,
      temperature: 0.2,
    })

    const parsedJson = JSON.parse(extractJson(content))
    return normalizeReview(parsedJson)
  },

  async *generate(description: string, counterpartyName: string, settings: AISettings) {
    const userPrompt = [
      `Сгенерируй проект договора с контрагентом "${counterpartyName}".`,
      'Верни только текст договора без markdown и пояснений.',
      `Описание задачи: ${description || 'не указано'}.`,
      `Уровень защиты интересов: ${settings.protectionLevel}/90.`,
      `Целевой объём: около ${settings.targetSize} знаков.`,
      settings.customInstruction ? `Дополнительная инструкция: ${settings.customInstruction}` : '',
      'Язык: русский.',
    ].filter(Boolean).join('\n')

    const payload = {
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: 'Ты составляешь юридически корректные проекты договоров на русском языке.' },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 3000,
      repetition_penalty: 1,
      temperature: 0.4,
    }

    yield* streamText(payload)
  },
}
