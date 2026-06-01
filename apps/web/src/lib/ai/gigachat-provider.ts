import { z } from 'zod'
import type { AIMessage, AIProvider, AISettings, CounterpartyData, ReviewResult, UserProfileData } from './types'

// GigaChat использует самоподписанный сертификат Сбера
// Устанавливаем переменную окружения до первого запроса
if (typeof process !== 'undefined') {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
}

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

// ─── Вспомогательные функции: форматирование данных для промпта ─────────────

const TYPE_RU: Record<string, string> = {
  SOLE_PROPRIETOR: 'ИП',
  COMPANY: 'ООО',
  INDIVIDUAL: 'Физлицо',
  ANO: 'АНО',
  PAO: 'ПАО',
  ZAO: 'ЗАО',
}

function partyFullName(name: string, type: string): string {
  const t = TYPE_RU[type] ?? type
  // Если имя уже содержит организационно-правовую форму — не дублируем
  if (name.startsWith('ИП ') || name.startsWith('ООО') || name.startsWith('АО') || name.startsWith('ПАО') || name.startsWith('ЗАО') || name.startsWith('АНО')) {
    return name
  }
  if (type === 'SOLE_PROPRIETOR') return `Индивидуальный предприниматель ${name}`
  if (type === 'COMPANY') return `Общество с ограниченной ответственностью «${name}»`
  return `${t} ${name}`
}

function buildBasisPhrase(type: string, ogrn: string | null | undefined, signatorBasis: string | null | undefined): string {
  if (signatorBasis) return signatorBasis
  if (type === 'SOLE_PROPRIETOR' && ogrn) return `ОГРНИП ${ogrn}`
  return 'Устава'
}

function buildContractHeader(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,   // «Заказчик» / «Исполнитель» и т.д.
  role2: string,
): string {
  const p1FullName = partyFullName(userProfile.name, userProfile.type)
  const p1Basis = buildBasisPhrase(userProfile.type, userProfile.ogrn, userProfile.signatorBasis)

  const p2Type = counterparty.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR'
  const p2FullName = partyFullName(counterparty.name, p2Type)
  const p2Basis = buildBasisPhrase(p2Type, counterparty.ogrn, counterparty.signatorBasis)

  const lines: string[] = []

  // Шапка стороны 1
  if (userProfile.type === 'SOLE_PROPRIETOR') {
    lines.push(`${p1FullName}, именуемый в дальнейшем «${role1}», действующий на основании ${p1Basis}, с одной стороны, и`)
  } else {
    const signatorPhrase = userProfile.signatorName
      ? `в лице ${userProfile.signatorPosition ?? 'директора'} ${userProfile.signatorName}, действующего на основании ${p1Basis},`
      : ''
    lines.push(`${p1FullName} ${signatorPhrase} именуемое в дальнейшем «${role1}», с одной стороны, и`)
  }

  // Шапка стороны 2
  if (p2Type === 'SOLE_PROPRIETOR') {
    const signLine = counterparty.signatorName ? counterparty.signatorName : counterparty.name
    lines.push(`Индивидуальный предприниматель ${signLine}, именуемый в дальнейшем «${role2}», действующий на основании ${p2Basis}, с другой стороны,`)
  } else {
    const signPhrase = counterparty.signatorName
      ? `в лице ${counterparty.signatorPosition ?? 'директора'} ${counterparty.signatorName}, действующего на основании ${p2Basis},`
      : ''
    lines.push(`${p2FullName} ${signPhrase} именуемое в дальнейшем «${role2}», с другой стороны,`)
  }

  lines.push('совместно именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем:')
  return lines.join('\n')
}

function buildRequisitesBlock(userProfile: UserProfileData, counterparty: CounterpartyData, role1: string, role2: string): string {
  const p1Lines: string[] = []
  const p2Lines: string[] = []

  // Сторона 1 (пользователь)
  p1Lines.push(`${role1}: ${partyFullName(userProfile.name, userProfile.type)}`)
  if (userProfile.legalAddress) p1Lines.push(`Адрес: ${userProfile.legalAddress}`)
  if (userProfile.inn) p1Lines.push(`ИНН: ${userProfile.inn}`)
  if (userProfile.kpp) p1Lines.push(`КПП: ${userProfile.kpp}`)
  if (userProfile.ogrn) p1Lines.push(`ОГРН: ${userProfile.ogrn}`)
  if (userProfile.checkingAccount) p1Lines.push(`Р/счет: ${userProfile.checkingAccount}`)
  if (userProfile.correspondentAccount) p1Lines.push(`К/счет: ${userProfile.correspondentAccount}`)
  if (userProfile.bankName) p1Lines.push(`Банк: ${userProfile.bankName}`)
  if (userProfile.bik) p1Lines.push(`БИК: ${userProfile.bik}`)
  if (userProfile.email) p1Lines.push(`E-mail: ${userProfile.email}`)
  const p1SignLine = userProfile.signatorName
    ? `${userProfile.signatorPosition ?? ''} ${userProfile.signatorName}`.trim()
    : userProfile.name
  p1Lines.push(`${p1SignLine} _________________`)

  // Сторона 2 (контрагент)
  const p2Type = counterparty.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR'
  p2Lines.push(`${role2}: ${partyFullName(counterparty.name, p2Type)}`)
  if (counterparty.legalAddress) p2Lines.push(`Адрес: ${counterparty.legalAddress}`)
  if (counterparty.inn) p2Lines.push(`ИНН: ${counterparty.inn}`)
  if (counterparty.kpp) p2Lines.push(`КПП: ${counterparty.kpp}`)
  if (counterparty.ogrn) p2Lines.push(`ОГРН: ${counterparty.ogrn}`)
  if (counterparty.checkingAccount) p2Lines.push(`Р/счет: ${counterparty.checkingAccount}`)
  if (counterparty.correspondentAccount) p2Lines.push(`К/счет: ${counterparty.correspondentAccount}`)
  if (counterparty.bankName) p2Lines.push(`Банк: ${counterparty.bankName}`)
  if (counterparty.bik) p2Lines.push(`БИК: ${counterparty.bik}`)
  if (counterparty.email) p2Lines.push(`E-mail: ${counterparty.email}`)
  const p2SignLine = counterparty.signatorName
    ? `${counterparty.signatorPosition ?? ''} ${counterparty.signatorName}`.trim()
    : counterparty.name
  p2Lines.push(`${p2SignLine} _________________`)

  return [p1Lines.join('\n'), '', p2Lines.join('\n')].join('\n')
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

  async *generate(
    description: string,
    counterpartyName: string,
    settings: AISettings,
    userProfile?: UserProfileData,
    counterpartyData?: CounterpartyData,
    parentDocContent?: string,
    referenceContent?: string,
  ) {
    // Определяем роли сторон из описания (грубая эвристика)
    const isUserExecutor = /исполн|подряд|оказ|услуг/i.test(description)
    const role1 = isUserExecutor ? 'Исполнитель' : 'Заказчик'
    const role2 = isUserExecutor ? 'Заказчик' : 'Исполнитель'

    // Строим готовую шапку договора если есть данные обеих сторон
    let headerBlock = ''
    let requisitesBlock = ''
    if (userProfile && counterpartyData) {
      headerBlock = buildContractHeader(userProfile, counterpartyData, role1, role2)
      requisitesBlock = buildRequisitesBlock(userProfile, counterpartyData, role1, role2)
    } else if (counterpartyData) {
      headerBlock = `Стороны: Пользователь («${role1}») и ${counterpartyData.name} («${role2}»)`
    }

    // Для русского текста ~1.5 символа на токен + 50% запас сверху
    const estimatedTokens = Math.ceil((settings.targetSize / 1.5) * 1.5)
    // GigaChat-2 поддерживает до 8192 токенов на выход
    const maxTokens = Math.min(Math.max(estimatedTokens, 3000), 8192)

    const isChildDoc = parentDocContent && parentDocContent.trim().length > 0
    const parentSnippet = isChildDoc ? parentDocContent!.slice(0, 10000) : null
    const referenceSnippet = referenceContent && referenceContent.trim().length > 0
      ? referenceContent.trim().slice(0, 6000)
      : null

    const systemPrompt = [
      isChildDoc
        ? 'Ты составляешь юридически корректные приложения и дополнительные соглашения к договорам на русском языке. Ты ОБЯЗАН опираться на условия основного договора и при наличии — на образец документа, которые будут предоставлены ниже.'
        : 'Ты составляешь юридически корректные проекты договоров на русском языке.',
      `ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ К ОБЪЁМУ: текст документа должен быть НЕ МЕНЕЕ ${settings.targetSize} знаков (символов с пробелами).`,
      'Если содержание исчерпано — добавь детализацию условий, типовые пункты об ответственности, форс-мажоре, порядке разрешения споров, конфиденциальности, заключительных положениях.',
      'НЕ сокращай, НЕ пиши «см. законодательство» вместо конкретных условий.',
      'Верни ТОЛЬКО текст документа — без markdown, без пояснений, без комментариев.',
    ].join('\n')

    const userPrompt = [
      parentSnippet ? `ОСНОВНОЙ ДОГОВОР (финальная версия — используй его условия, стороны и терминологию как базу):\n---\n${parentSnippet}\n---\n` : '',
      referenceSnippet ? `ОБРАЗЕЦ ДОКУМЕНТА (предыдущий аналогичный документ — используй его структуру, разделы и формулировки как шаблон, адаптируй под новое задание):\n---\n${referenceSnippet}\n---\n` : '',
      headerBlock ? `ШАПКА ДОКУМЕНТА (используй точно эти данные, не придумывай другие):\n${headerBlock}` : `Стороны: Пользователь («${role1}») и "${counterpartyName}" («${role2}»).`,
      '',
      `Описание задачи: ${description || 'не указано'}.`,
      isChildDoc ? 'ЖЁСТКОЕ ТРЕБОВАНИЕ: этот документ является приложением/доп.соглашением к договору выше. Ссылайся на его пункты (например: «в соответствии с п. X основного договора»), используй те же стороны, реквизиты, терминологию. НЕ дублируй весь договор — только дополняй или изменяй конкретные условия.' : '',
      `Уровень защиты интересов ${role1}: ${settings.protectionLevel}% (чем выше — тем больше пунктов о неустойках, гарантиях, ответственности).`,
      `МИНИМАЛЬНЫЙ объём: ${settings.targetSize} знаков. Пиши развёрнуто, с детализацией каждого раздела.`,
      settings.customInstruction ? `\nОБЯЗАТЕЛЬНО выполни следующие инструкции (это жёсткие требования к содержанию):\n${settings.customInstruction}` : '',
      requisitesBlock ? `\nВ конце документа ОБЯЗАТЕЛЬНО размести раздел «Реквизиты и подписи сторон» в следующем формате:\n${requisitesBlock}` : '',
      '\nЯзык: только русский.',
    ].filter(Boolean).join('\n')

    const payload = {
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      repetition_penalty: 1.05,
      temperature: 0.4,
    }

    yield* streamText(payload)
  },
}
