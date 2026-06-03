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
    'Ты опытный юрист-практик с 15-летним стажем в договорной работе. Специализация — защита интересов ИП и малого бизнеса.',
    'Отвечаешь чётко, конкретно, по делу. Даёшь практичные советы, а не общие фразы.',
    'Если видишь риск — называешь его прямо и объясняешь как устранить. Ссылаешься на нормы ГК РФ где это уместно.',
    'Никогда не пишешь «согласно законодательству» или «см. нормативные акты» — только конкретику.',
    `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90. Чем выше — тем агрессивнее защищаешь его позицию: больше неустоек, гарантий, ограничений ответственности.`,
    settings.customInstruction ? `Особые требования клиента: ${settings.customInstruction}` : '',
    'ВАЖНО: Реквизиты сторон (ИНН, КПП, ОГРН, банковские счета, адреса, подписи), а также номер и дата договора управляются системой автоматически — они берутся из профиля пользователя и карточки контрагента. Если пользователь просит изменить реквизиты или шапку через чат — вежливо объясни: «Реквизиты и шапка договора подставляются автоматически из вашего профиля и карточки контрагента. Чтобы изменить их, обновите данные в разделе «Мои реквизиты» или в карточке контрагента.» Не пытайся изменить или добавить реквизиты в текст договора.',
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
  if (name.startsWith('ИП ') || name.startsWith('ООО') || name.startsWith('АО') || name.startsWith('ПАО') || name.startsWith('ЗАО') || name.startsWith('АНО') || name.startsWith('Общество') || name.startsWith('Индивидуальный') || name.startsWith('Акционерное') || name.startsWith('Публичное') || name.startsWith('Частное')) {
    return name
  }
  if (type === 'SOLE_PROPRIETOR') return `Индивидуальный предприниматель ${name}`
  if (type === 'COMPANY') return `Общество с ограниченной ответственностью «${name}»`
  return `${t} ${name}`
}

function buildBasisPhrase(type: string, ogrn: string | null | undefined, signatorBasis: string | null | undefined, ogrnDate?: string | null): string {
  // Если signatorBasis — только цифры, это ОГРН/ОГРНИП без метки — форматируем правильно
  if (signatorBasis && /^\d+$/.test(signatorBasis.trim())) {
    if (type === 'SOLE_PROPRIETOR') {
      return ogrnDate ? `ОГРНИП ${signatorBasis} от ${ogrnDate} г.` : `ОГРНИП ${signatorBasis}`
    }
    return `ОГРН ${signatorBasis}`
  }
  if (signatorBasis) return signatorBasis
  if (type === 'SOLE_PROPRIETOR' && ogrn) {
    return ogrnDate ? `ОГРНИП ${ogrn} от ${ogrnDate} г.` : `ОГРНИП ${ogrn}`
  }
  return 'Устава'
}

function buildContractHeader(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
  city?: string,
  signingDate?: string,
): string {
  const p1FullName = partyFullName(userProfile.name, userProfile.type)
  const p1Basis = buildBasisPhrase(userProfile.type, userProfile.ogrn, userProfile.signatorBasis, userProfile.ogrnDate)

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
    const signLine = counterparty.signatorName ? counterparty.signatorName : '____________'
    const basisLine = counterparty.signatorName ? p2Basis : '_____________'
    lines.push(`Индивидуальный предприниматель ${signLine}, именуемый в дальнейшем «${role2}», действующий на основании ${basisLine}, с другой стороны,`)
  } else {
    const signPhrase = counterparty.signatorName
      ? `в лице ${counterparty.signatorPosition ?? 'директора'} ${counterparty.signatorName}, действующего на основании ${p2Basis},`
      : `в лице _____________, действующего на основании _____________,`
    lines.push(`${p2FullName} ${signPhrase} именуемое в дальнейшем «${role2}», с другой стороны,`)
  }

  lines.push('совместно именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем:')

  const cityLine = `г. ${city ?? 'Москва'}`
  const dateLine = signingDate
    ? new Date(signingDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '«___» ____________ 202__ г.'

  return `${cityLine}\t\t\t\t\t${dateLine}\n\n` + lines.join('\n')
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
      max_tokens: 32768,
      repetition_penalty: 1,
      temperature: 0.4,
    }

    yield* streamText(payload)
  },

  async *editDocument(documentText: string, instruction: string, settings: AISettings) {
    const systemPrompt = [
      'Ты юрист-редактор договоров. Твоя единственная задача — применить ТОЛЬКО запрошенное изменение к тексту договора.',
      '',
      'ЖЕЛЕЗНЫЕ ПРАВИЛА:',
      '1. Верни ПОЛНЫЙ текст договора — от первой строки до последней. НЕ добавляй блок реквизитов (ИНН, КПП, счета, подписи) — он управляется системой автоматически.',
      '2. Измени ТОЛЬКО то, что прямо указано в инструкции. Всё остальное — слово в слово как в оригинале.',
      '3. Не переформулируй, не улучшай, не сокращай другие разделы. Не добавляй то, о чём не просили.',
      '4. Если инструкция неоднозначна — трактуй её минимально: меняй как можно меньше.',
      '5. Ответ — ТОЛЬКО текст договора. Никаких пояснений, никаких вводных заголовков вроде «Обновлённый договор:». Сохрани markdown-форматирование оригинала: **жирные** заголовки разделов, нумерацию 1., 1.1., 1.1.1.',
      '',
      `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90. При добавлении новых условий — формулируй в пользу клиента.`,
      settings.customInstruction ? `Дополнительные требования: ${settings.customInstruction}` : '',
    ].filter(Boolean).join('\n')

    const userMessage = [
      `ИНСТРУКЦИЯ (применить только это): ${instruction}`,
      '',
      'ТЕКУЩИЙ ТЕКСТ ДОГОВОРА (вернуть его полностью с применённым изменением):',
      documentText || '(документ пуст — создай новый договор согласно инструкции)',
    ].join('\n')

    // Динамически считаем max_tokens: нужно вернуть как минимум столько же, сколько входящий документ
    // ~1.5 символа на токен для русского текста + 30% запас на добавленный контент
    const docTokensEstimate = Math.ceil((documentText.length || 1000) / 1.5)
    const maxTokens = Math.max(docTokensEstimate + 2000, 8000)

    const payload = {
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      repetition_penalty: 1,
      temperature: 0.3,
    }

    yield* streamText(payload)
  },

  async review(documentText: string, settings: AISettings): Promise<ReviewResult> {
    const systemContent = [
      'Ты старший юрист-аудитор с опытом проверки сотен договоров. Анализируешь договоры на предмет рисков для клиента.',
      'Возвращай ТОЛЬКО валидный JSON без markdown-обёртки, без пояснений до и после.',
      '',
      'Принципы анализа:',
      '- Каждое замечание привязано к конкретному пункту договора.',
      '- Описание проблемы: что именно не так и чем это грозит клиенту (конкретные последствия).',
      '- Никаких общих фраз типа «рекомендуем уточнить» — только конкретика: что изменить и как.',
      '- Ссылки на ГК РФ (ст. 330, 401, 421 и т.д.) где уместно.',
      `- Оцениваешь с позиции стороны с уровнем защиты ${settings.protectionLevel}/90: чем выше — тем строже смотришь на риски для клиента.`,
    ].join('\n')

    const prompt = [
      'Проверь договор и верни JSON строго в следующем формате:',
      '{',
      '  "score": 72,',
      '  "summary": "2-3 предложения: тип договора, общая оценка, главный риск",',
      '  "issues": [',
      '    {',
      '      "id": "1",',
      '      "severity": "risk",',
      '      "title": "Короткое название проблемы (до 60 символов)",',
      '      "description": "Конкретная проблема + последствия для клиента + как исправить. Минимум 2 предложения.",',
      '      "clause": "п. 3.2"',
      '    }',
      '  ]',
      '}',
      '',
      'Правила:',
      '- score: 0..100 (100 = идеальный договор, 0 = нельзя подписывать)',
      '- issues: от 4 до 12 замечаний',
      '- severity: risk (серьёзный риск — красный), warning (замечание — жёлтый), ok (плюс — зелёный)',
      '- Минимум 1 пункт ok (что сделано хорошо в договоре)',
      '- clause: точный номер пункта из договора или «нет» если пункт отсутствует',
      '',
      settings.customInstruction ? `Особые требования при проверке: ${settings.customInstruction}\n` : '',
      'Текст договора:',
      documentText || '(пустой текст — укажи в summary что документ пуст, score=0, 1 issue severity=risk)',
    ].filter(Boolean).join('\n')

    const content = await completeText({
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2500,
      repetition_penalty: 1,
      temperature: 0.15,
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
    base?: string,
    userRole?: 'customer' | 'executor',
    city?: string,
    signingDate?: string,
  ) {
    // Определяем роли сторон по явному выбору пользователя
    const role1 = userRole === 'executor' ? 'Исполнитель' : 'Заказчик'
    const role2 = userRole === 'executor' ? 'Заказчик' : 'Исполнитель'

    // Строим готовую шапку договора если есть данные обеих сторон
    let headerBlock = ''
    if (userProfile && counterpartyData) {
      headerBlock = buildContractHeader(userProfile, counterpartyData, role1, role2, city, signingDate)
    } else if (counterpartyData) {
      headerBlock = `Стороны: Пользователь («${role1}») и ${counterpartyData.name} («${role2}»)`
    }

    // Для русского текста ~1.5 символа на токен + 50% запас сверху
    const estimatedTokens = Math.ceil((settings.targetSize / 1.5) * 1.5)
    const maxTokens = Math.max(estimatedTokens, 8000)

    const isChildDoc = parentDocContent && parentDocContent.trim().length > 0
    const parentSnippet = isChildDoc ? parentDocContent!.slice(0, 10000) : null
    const referenceSnippet = referenceContent && referenceContent.trim().length > 0
      ? referenceContent.trim().slice(0, 8000)
      : null

    // ── Режим «заполнение бланка» (base=upload + есть referenceContent) ────────
    // Пользователь загрузил готовый бланк/шаблон. ИИ НЕ переписывает его —
    // только подставляет данные сторон, даты, суммы и условия из описания.
    const isFillTemplate = base === 'upload' && Boolean(referenceSnippet)

    if (isFillTemplate) {
      const partyInfo = headerBlock
        ? `ДАННЫЕ СТОРОН (подставь точно эти данные в бланк):\n${headerBlock}`
        : `Стороны: Пользователь («${role1}») и "${counterpartyName}" («${role2}»).`

      const systemPrompt = [
        'АНАЛИЗ ОБРАЗЦА:',
        'Перед заполнением внимательно изучи структуру и логику бланка:',
        '1. Определи тип договора и отрасль',
        '2. Выяви какая сторона защищена сильнее (чьи интересы приоритетны в формулировках)',
        '3. Запомни стиль: официальный/деловой, краткий/развёрнутый, структуру нумерации',
        '4. Сохрани все защитные клаузулы оригинала — они не случайны',
        'При заполнении: используй тот же стиль, те же принципы защиты, ту же логику что в образце.',
        '',
        'Ты юридический помощник. Задача: заполнить готовый бланк договора данными сторон и конкретными условиями.',
        '',
        'СТРОГИЕ ПРАВИЛА:',
        '1. Верни бланк с МИНИМАЛЬНЫМИ изменениями — сохрани ВСЕ формулировки, нумерацию пунктов, структуру разделов, пунктуацию и стиль текста.',
        '2. ТОЛЬКО подставь в бланк: наименования сторон, роли (Заказчик/Исполнитель), реквизиты, даты, суммы, предмет договора и другие конкретные данные.',
        '3. НЕ добавляй новые разделы, НЕ удаляй существующие, НЕ переформулируй условия бланка.',
        '4. Заменяй ВСЕ заполнители: [Исполнитель], [Заказчик], «____», «№ ___», «__.__.__», «{дата}», «[сумма]» и подобные — реальными данными из задания.',
        '5. Если в задании нет конкретной даты — поставь «___ ____________ 202__ г.». Если нет суммы — поставь «__________ руб. 00 коп.».',
        '6. Верни ТОЛЬКО текст заполненного договора — без пояснений, без вводных слов. Используй markdown: **Заголовки разделов** жирным, нумерацию 1., 1.1., 1.1.1.',
      ].join('\n')

      const userPrompt = [
        `БЛАНК ДОГОВОРА (заполни его — не переписывай):\n---\n${referenceSnippet}\n---`,
        '',
        partyInfo,
        '',
        `Условия для заполнения: ${description || 'использовать данные сторон из шапки'}`,
        settings.customInstruction ? `\nДополнительные инструкции: ${settings.customInstruction}` : '',
        'СТОП: КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО добавлять раздел реквизитов, банковских данных, ИНН, КПП, счетов, подписей и печатей. Не пиши разделы «Реквизиты», «Место нахождения», «Подписи сторон» и любые аналоги. Заканчивай договор разделом «Заключительные положения» и больше ничего не добавляй.',
        '\nЯзык: только русский.',
      ].filter(Boolean).join('\n')

      yield* streamText({
        model: GIGACHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        repetition_penalty: 1.0,
        temperature: 0.2,  // Низкая температура — точное следование бланку
      })
      return
    }

    // ── Стандартный режим генерации (scratch / template / приложения/ДС) ───────
    const structureRequirement = isChildDoc
      ? [
          'ОБЯЗАТЕЛЬНАЯ СТРУКТУРА (все разделы должны присутствовать):',
          '1. Реквизиты документа (номер, дата, место)',
          '2. Ссылка на основной договор',
          '3. Предмет изменений / дополнений',
          '4. Изменяемые / дополняемые условия (пронумерованные пункты с явной ссылкой на изменяемый раздел основного договора)',
          '5. Порядок вступления в силу',
          '6. Прочие условия',
          '7. Реквизиты и подписи сторон',
        ].join('\n')
      : [
          'ОБЯЗАТЕЛЬНАЯ СТРУКТУРА (все разделы должны присутствовать, каждый развёрнут детально):',
          'ПРЕАМБУЛА (НЕ нумеруй как раздел): вводный абзац со сторонами — вставляется из данных системы, не пиши сам. Начинай нумерованные разделы с «1. ПРЕДМЕТ ДОГОВОРА».',
          '1. Предмет договора (конкретное описание, объём, результат)',
          '2. Права и обязанности сторон (отдельно для каждой стороны, детально)',
          '3. Цена и порядок оплаты (сумма, валюта, сроки, способ, основания для изменения)',
          '4. Сроки выполнения (начало, конец, промежуточные этапы если применимо)',
          '5. Порядок сдачи-приёмки (процедура, документы, сроки подписания актов)',
          '6. Ответственность сторон (конкретные санкции: % неустойки в день или год, максимальный размер)',
          '7. Форс-мажор (перечень обстоятельств, сроки уведомления, последствия)',
          '8. Конфиденциальность (что является тайной, срок обязательства, исключения)',
          '9. Срок действия договора и порядок расторжения (основания, уведомление за N дней)',
          '10. Порядок разрешения споров (претензионный порядок, срок ответа, суд)',
          '11. Заключительные положения (изменения только письменно, количество экземпляров)',
          '12. Реквизиты и подписи сторон',
          '',
          'ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ К НУМЕРАЦИИ:',
          'Каждый раздел состоит из нумерованных подпунктов. Пример правильной структуры:',
          '**1. ПРЕДМЕТ ДОГОВОРА**',
          '1.1. Исполнитель обязуется...',
          '1.2. Результатом оказания услуг является...',
          '1.3. Услуги оказываются по адресу...',
          '',
          '**2. ПРАВА И ОБЯЗАННОСТИ СТОРОН**',
          '2.1. Исполнитель обязан:',
          '2.1.1. выполнить...',
          '2.1.2. предоставить...',
          '2.2. Заказчик обязан:',
          '2.2.1. оплатить...',
          '',
          'ЗАПРЕЩЕНО писать текст внутри раздела без нумерации подпунктов. Каждое условие — отдельный пронумерованный подпункт.',
        ].join('\n')

    const systemPrompt = isChildDoc
      ? [
          'Ты опытный юрист. Составляешь юридически грамотное приложение или дополнительное соглашение к договору на русском языке. Опираешься на условия основного договора.',
          '',
          structureRequirement,
          '',
          'СТАНДАРТЫ КАЧЕСТВА:',
          '- Ссылайся на нормы ГК РФ где уместно.',
          '- НЕ пиши «согласно законодательству», «в установленном порядке» — всегда конкретика.',
          '- НЕ оставляй незаполненных заглушек типа «___», «N руб.», «дата».',
          '',
          `ОБЯЗАТЕЛЬНЫЙ МИНИМАЛЬНЫЙ ОБЪЁМ: НЕ МЕНЕЕ ${settings.targetSize} знаков.`,
          'Верни ТОЛЬКО текст документа — без пояснений, без комментариев.',
          'ФОРМАТИРОВАНИЕ: используй markdown — заголовки разделов выдели **жирным**, нумерацию строй через 1., 1.1., 1.1.1. Названия разделов пиши заглавными буквами и **жирно**.',
        ].join('\n')
      : [
          '=== ФОРМАТ ВЫВОДА — СОБЛЮДАТЬ СТРОГО ===',
          'Договор состоит из разделов. Каждый раздел — это заголовок + нумерованные подпункты.',
          'Подпункты нумеруются через точку: 1.1. 1.2. 1.3. — для раздела 1; 2.1. 2.2. — для раздела 2; и т.д.',
          'ЗАПРЕЩЕНО писать обычные абзацы внутри раздела. Каждое условие — отдельный подпункт с номером.',
          'ЗАПРЕЩЕНО использовать маркированные списки (- или *).',
          'ЗАПРЕЩЕНО нумеровать подпункты с нуля (1., 2., 3.) внутри раздела — только 2.1., 2.2., 2.3.',
          '',
          'Пример ПРАВИЛЬНОГО формата:',
          '**1. ПРЕДМЕТ ДОГОВОРА**',
          '1.1. Исполнитель обязуется оказать услуги по фотосъёмке мероприятия.',
          '1.2. Услуги оказываются в период с 3 по 4 июня 2023 года.',
          '1.3. Место оказания услуг: г. Санкт-Петербург.',
          '',
          '**2. ЦЕНА И ПОРЯДОК ОПЛАТЫ**',
          '2.1. Стоимость услуг составляет 150 000 рублей.',
          '2.2. Заказчик вносит аванс 50% в течение 3 рабочих дней с даты подписания.',
          '2.3. Остаток оплачивается в течение 5 рабочих дней после подписания акта.',
          '=== КОНЕЦ ТРЕБОВАНИЙ К ФОРМАТУ ===',
          '',
          'Ты старший юрист с 15-летним опытом договорной работы в России. Твоя специализация — составление договоров для малого бизнеса и ИП. Ты знаешь не только нормы закона, но и реальную практику: какие пункты чаще всего становятся причиной споров, какие формулировки работают в суде, какие условия стороны обычно упускают и потом жалеют.',
          '',
          'ШАГ 1 — АНАЛИЗ ЗАДАЧИ (выполни мысленно перед составлением):',
          'Определи:',
          '- Тип договора (подряд, услуги, поставка, аренда, лицензия, агентский, смешанный и т.д.)',
          '- Отрасль и специфику (IT-разработка, строительство, медицина, торговля, реклама, логистика, консалтинг и т.д.)',
          '- Сложность сделки (разовая/длящаяся, крупная/мелкая, с предоплатой/постоплатой, с результатом/процессом)',
          '- Типичные риски именно в этой отрасли',
          '',
          'ШАГ 2 — ОТРАСЛЕВАЯ ЭКСПЕРТИЗА:',
          'Применяй знания специфики отрасли:',
          '',
          'IT и разработка ПО: права на интеллектуальную собственность (ст. 1296 ГК — служебное произведение vs заказное), приёмка по ТЗ, баг-репорты, поэтапная оплата по майлстоунам, условия передачи исходного кода, SLA, доступы и пароли после расторжения, NDA на алгоритмы',
          '',
          'Строительство и ремонт: смета как неотъемлемая часть, скрытые работы и промежуточные акты, гарантийный срок на работы (не менее 5 лет по ст. 756 ГК), право заказчика на проверку хода работ, удержание 5-10% до подписания финального акта, ответственность за повреждение имущества',
          '',
          'Маркетинг и реклама: права на созданные материалы (логотипы, тексты, видео), согласование макетов до запуска, KPI и что происходит при их недостижении, доступы к рекламным кабинетам, конфиденциальность бюджетов',
          '',
          'Поставка и торговля: спецификация как неотъемлемая часть, порядок приёмки по количеству и качеству (Инструкции П-6 и П-7), сроки предъявления претензий по скрытым недостаткам, возврат некондиции, ответственность за задержку поставки',
          '',
          'Аренда: акт приёма-передачи с описанием состояния, разграничение текущего и капитального ремонта, что происходит с улучшениями, порядок досрочного расторжения и штрафы за него, возврат депозита',
          '',
          'Консалтинг и юридические услуги: результат vs усилия, защита от «переманивания» сотрудников, конфиденциальность данных клиента, ограничение ответственности консультанта суммой договора',
          '',
          'Медицина и здоровье: информированное согласие пациента, ограничение ответственности за результат лечения, порядок хранения и передачи медицинских данных (ФЗ-323)',
          '',
          'Логистика и перевозки: ответственность за груз (ст. 796 ГК), страхование, документы на груз, форс-мажор при таможенных задержках',
          '',
          'Для любой отрасли — добавляй пункты которые ОБЫЧНО ЗАБЫВАЮТ:',
          '- Что происходит с результатами работы при досрочном расторжении (кто кому что должен)',
          '- Порядок передачи данных, доступов, документов при окончании договора',
          '- Запрет переуступки прав без письменного согласия',
          '- Порядок привлечения субподрядчиков (разрешено/нет, ответственность)',
          '- Что считается надлежащим уведомлением (email, мессенджер, письмо)',
          '- Применимое право и договорная подсудность (в каком суде рассматриваются споры)',
          '',
          'ШАГ 3 — ГЛУБИНА ПРОРАБОТКИ:',
          'Качество важнее скорости. Каждый раздел должен быть проработан детально:',
          '- Права и обязанности: минимум 5-7 конкретных пунктов для каждой стороны, не общие фразы',
          '- Ответственность: конкретные санкции с цифрами (%, суммы, сроки), разные санкции за разные нарушения',
          '- Расторжение: отдельно по соглашению сторон, отдельно односторонний отказ, что происходит с деньгами и результатами в каждом случае',
          '- Форс-мажор: конкретный перечень обстоятельств, конкретные сроки уведомления и подтверждения',
          '- Чем сложнее и дороже сделка — тем детальнее каждый раздел',
          '',
          structureRequirement,
          '',
          'СТАНДАРТЫ КАЧЕСТВА:',
          '- Ссылайся на нормы ГК РФ и отраслевое законодательство где уместно',
          '- Неустойка: конкретный % (0,1-0,5% от суммы за каждый день просрочки в зависимости от сферы)',
          '- Претензионный порядок: конкретный срок (10-30 рабочих дней)',
          '- ЗАПРЕЩЕНО: «согласно законодательству», «в установленном порядке», «по соглашению сторон» без конкретики',
          '- ЗАПРЕЩЕНО: незаполненные заглушки «___», «N руб.» — всегда типовой пример или разумное условие',
          '- Объём — это не вода, а реальная детализация. Каждый знак должен нести смысл.',
          '',
          `ОБЯЗАТЕЛЬНЫЙ МИНИМАЛЬНЫЙ ОБЪЁМ: НЕ МЕНЕЕ ${settings.targetSize} знаков.`,
          'Верни ТОЛЬКО текст документа — без пояснений, без комментариев.',
          'ФОРМАТИРОВАНИЕ: используй markdown — заголовки разделов выдели **жирным**, нумерацию строй через 1., 1.1., 1.1.1. Названия разделов пиши заглавными буквами и **жирно**.',
        ].join('\n')

    const protectionNote = settings.protectionLevel >= 60
      ? `Уровень защиты интересов «${role1}»: ${settings.protectionLevel}/90 (ВЫСОКИЙ). Максимально защити позицию «${role1}»: повышенные неустойки в его пользу, расширенные права, ограниченная ответственность «${role1}» за косвенные убытки, жёсткие обязательства «${role2}».`
      : settings.protectionLevel >= 30
      ? `Уровень защиты: ${settings.protectionLevel}/90 (СБАЛАНСИРОВАННЫЙ). Договор защищает обе стороны примерно поровну, разумные санкции.`
      : `Уровень защиты: ${settings.protectionLevel}/90 (НЕЙТРАЛЬНЫЙ). Минимальные неустойки, симметричные права и обязанности.`

    const userPrompt = [
      parentSnippet ? `ОСНОВНОЙ ДОГОВОР (используй его условия, стороны и терминологию как базу — создаваемый документ является приложением/ДС к нему):\n---\n${parentSnippet}\n---\n` : '',
      referenceSnippet ? `ОБРАЗЕЦ ДОКУМЕНТА (изучи его тип, сферу, стиль защиты и логику условий — адаптируй под новое задание сохраняя эти принципы):\n---\n${referenceSnippet}\n---\n` : '',
      headerBlock ? `ШАПКА ДОКУМЕНТА (используй ТОЧНО эти данные — не придумывай другие ФИО, ИНН, роли):\n${headerBlock}` : `Стороны: Пользователь («${role1}») и "${counterpartyName}" («${role2}»).`,
      '',
      `ЗАДАЧА: ${description || 'составить договор между сторонами'}`,
      '',
      isChildDoc ? `ЖЁСТКОЕ ТРЕБОВАНИЕ: этот документ — приложение/доп.соглашение к договору выше. Ссылайся на его конкретные пункты (например: «в соответствии с п. 3.1 Договора»). НЕ дублируй полный текст основного договора. Только дополняй или изменяй конкретные условия.` : '',
      protectionNote,
      `МИНИМАЛЬНЫЙ ОБЪЁМ: ${settings.targetSize} знаков.`,
      settings.customInstruction ? `\nОБЯЗАТЕЛЬНЫЕ ДОПОЛНИТЕЛЬНЫЕ УСЛОВИЯ (включить в текст договора):\n${settings.customInstruction}` : '',
      'ВАЖНО: НЕ добавляй в конец договора раздел с реквизитами сторон (ИНН, КПП, банковские счета, подписи). Система добавит его автоматически из базы данных. Заканчивай текст договора заключительными положениями.',
      '\nЯзык: только русский.',
      '\n=== ОБЯЗАТЕЛЬНЫЙ ФОРМАТ ВЫВОДА ===',
      'СТРУКТУРА НУМЕРАЦИИ — строго как в юридическом договоре:',
      '**1. ПРЕДМЕТ ДОГОВОРА**',
      '1.1. Исполнитель обязуется...',
      '1.2. Результатом является...',
      '1.3. Услуги оказываются...',
      '',
      '**2. ПРАВА И ОБЯЗАННОСТИ СТОРОН**',
      '2.1. Исполнитель обязан:',
      '2.1.1. выполнить...',
      '2.1.2. предоставить...',
      '2.2. Заказчик обязан:',
      '2.2.1. оплатить...',
      '',
      'ЗАПРЕЩЕНО: писать подпункты как "1.", "2.", "3." — только "2.1.", "2.2.", "2.3."',
      'ЗАПРЕЩЕНО: писать свободный текст внутри раздела без нумерации.',
      'ЗАПРЕЩЕНО: использовать markdown-списки (- пункт, * пункт).',
      'Минимум 5 подпунктов (X.1., X.2., ...) в каждом разделе.',
    ].filter(Boolean).join('\n')

    yield* streamText({
      model: GIGACHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      repetition_penalty: 1.05,
      temperature: 0.4,
    })
  },
}
