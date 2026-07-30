import { z } from 'zod'
import type { AIMessage, AIProvider, AISettings, CounterpartyData, ReviewResult, UserProfileData } from './types'
import { splitHtmlBlocks, blocksToPromptText, parseBlockOps, applyBlockOps, validateHtmlFragment, BLOCK_EDIT_INSTRUCTION } from '../doc-blocks'
import type { AITask } from './tasks'
import { getActiveModelId, getActiveTemperature, getPrimaryTask } from './config/runtime'
import { completeCompletion, streamCompletion } from './transport'
import { splitRequisitesBlock } from '../html-document'

// GigaChat использует самоподписанный сертификат Сбера
// Устанавливаем переменную окружения до первого запроса
if (typeof process !== 'undefined') {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
}

const GIGACHAT_AUTH_URL = process.env['GIGACHAT_AUTH_URL'] ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
const GIGACHAT_BASE_URL = (process.env['GIGACHAT_BASE_URL'] ?? 'https://gigachat.devices.sberbank.ru/api/v1').replace(/\/+$/, '')
const GIGACHAT_SCOPE = process.env['GIGACHAT_SCOPE'] ?? 'GIGACHAT_API_PERS'
// Max — для генерации, редактирования и анализа (мягче фильтры безопасности).
// GigaChat-2 — быстрые задачи с высоким RPM (орфография, реквизиты).
const GIGACHAT_MODEL = process.env['GIGACHAT_MODEL'] ?? 'GigaChat-2-Max'
const GIGACHAT_REVIEW_MODEL = process.env['GIGACHAT_REVIEW_MODEL'] ?? 'GigaChat-2-Max'
const GIGACHAT_FAST_MODEL = process.env['GIGACHAT_FAST_MODEL'] ?? 'GigaChat-2'
const GIGACHAT_AUTH_KEY = process.env['GIGACHAT_AUTH_KEY'] ?? ''

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  spellCount: z.number().int().min(0).default(0),
  issues: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      severity: z.enum(['risk', 'warning', 'ok', 'neutral']),
      importance: z.enum(['high', 'medium', 'low']).default('medium'),
      title: z.string().min(1),
      description: z.string().min(1),
      clause: z.string().min(1),
      recommendation: z.string().optional(),
      category: z.string().optional(),
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
    `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90. Чем выше — тем агрессивнее защищаешь его позицию.`,
    settings.customInstruction ? `Особые требования: ${settings.customInstruction}` : '',
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

async function* streamText(payload: Record<string, unknown>, task: AITask, retries = 4): AsyncGenerator<string> {
  void retries
  yield* streamCompletion(payload, task)
}

async function completeText(payload: Record<string, unknown>, task: AITask, retries = 4): Promise<string> {
  const result = await completeCompletion(payload, task, retries)
  return result.trim()
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
    importance: issue.importance ?? 'medium',
    title: issue.title,
    description: issue.description,
    clause: issue.clause,
    recommendation: issue.recommendation,
    category: issue.category,
  }))

  return {
    score: Math.round(parsed.score),
    summary: parsed.summary,
    spellCount: parsed.spellCount ?? 0,
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

// ─── Отдельная проверка орфографии ────────────────────────────────────────────
// Выполняется отдельным запросом чтобы не «теряться» внутри большого промпта.
// Текст бьётся на чанки по 4000 символов — ИИ читает каждый сегмент целиком.

async function checkSpelling(documentText: string): Promise<number> {
  if (!documentText || documentText.trim().length < 20) return 0

  // Чанки по 6000 символов — баланс между внимательностью и количеством запросов.
  // Для типичного договора (~30–70 КБ) это 5–12 чанков.
  // GigaChat-2-Max — чанки побольше, ограничений по количеству нет
  const CHUNK_SIZE = 8000
  const chunks: string[] = []
  let pos = 0
  while (pos < documentText.length) {
    chunks.push(documentText.slice(pos, pos + CHUNK_SIZE))
    pos += CHUNK_SIZE
  }

  const systemContent = [
    'Ты корректор. Твоя единственная задача — найти орфографические ошибки в тексте.',
    'Возвращай ТОЛЬКО целое число — количество найденных ошибок. Никакого текста, только цифра.',
    '',
    'ЧТО СЧИТАТЬ ОШИБКОЙ (считай каждую отдельно):',
    '  1. Орфографические ошибки — неправильное написание слова: «направлиемые» → ошибка',
    '  2. Обрезанные слова — слово явно не дописано до конца: «настоя» вместо «настоящего», «осаществ» вместо «осуществляется» → каждое считается отдельной ошибкой',
    '  3. Опечатки — буквы переставлены, пропущены или лишние',
    '  4. Слитное написание двух слов: «вдоговоре» → ошибка',
    '',
    'ЧТО НЕ СЧИТАТЬ:',
    '  - Пунктуация, стиль, заголовки без точки',
    '  - Сокращения: п., ст., т.д., и/или, №, разд.',
    '  - Иностранные слова, бренды, аббревиатуры (YouTube, TikTok, instagram, УСН, НДС)',
    '  - Числа, даты, ИНН, ОГРНИП, БИК, расчётные счета',
    '',
    'Формат ответа — ТОЛЬКО цифра: 0',
  ].join('\n')

  // Батчи по 2 с паузой 1.5 сек между ними — не перегружаем GigaChat rate limit
  const BATCH_SIZE = 2
  let totalErrors = 0

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    if (i > 0) {
      // Пауза между батчами — GigaChat-2-Max имеет более строгий rate limit
      await new Promise((r) => setTimeout(r, 4000))
    }

    const batch = chunks.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map((chunk) =>
        completeText({
          model: getActiveModelId('spelling', GIGACHAT_FAST_MODEL),
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: `Текст:\n\n${chunk}` },
          ],
          max_tokens: 8,
          repetition_penalty: 1,
          temperature: getActiveTemperature('spelling', 0),
        }, 'spelling').then((res) => {
          const match = res.trim().match(/\d+/)
          return match ? parseInt(match[0], 10) : 0
        }).catch(() => 0),
      ),
    )
    totalErrors += batchResults.reduce((sum, n) => sum + n, 0)
  }

  return totalErrors
}

/**
 * Конвертирует HTML договора в упрощённый Markdown для передачи AI.
 * Плейсхолдеры [TABLE_N] сохраняются как есть.
 * AI работает с чистым текстом — быстрее и лучше понимает смысл.
 */
function htmlToEditMarkdown(html: string): string {
  return html
    // Плейсхолдеры таблиц — сохраняем
    // Заголовки
    .replace(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi, (_, t) => `\n**${stripTags(t).trim()}**\n`)
    .replace(/<h[3-4][^>]*>([\s\S]*?)<\/h[3-4]>/gi, (_, t) => `\n### ${stripTags(t).trim()}\n`)
    // Жирный / курсив
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${stripTags(t)}**`)
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${stripTags(t)}**`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${stripTags(t)}*`)
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, t) => `*${stripTags(t)}*`)
    // Списки
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripTags(t).trim()}\n`)
    .replace(/<\/[uo]l>/gi, '\n')
    .replace(/<[uo]l[^>]*>/gi, '\n')
    // Параграфы
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `${stripTags(t).trim()}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    // Убираем оставшиеся теги
    .replace(/<[^>]+>/g, '')
    // Нормализуем пустые строки
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

/**
 * Конвертирует Markdown (ответ AI) обратно в HTML.
 * Используется после editDocument когда AI вернул Markdown.
 */
function editMarkdownToHtml(md: string): string {
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`)
    .split('\n\n')
    .map(block => {
      const t = block.trim()
      if (!t) return ''
      if (/^<(h[1-4]|ul|ol|li|table|\[TABLE)/.test(t)) return t
      // Многострочный блок → несколько <p>
      return t.split('\n').filter(l => l.trim()).map(l => {
        const lt = l.trim()
        if (/^<(h[1-4]|ul|li|\[TABLE)/.test(lt)) return lt
        return `<p>${lt}</p>`
      }).join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

// ─── SEARCH/REPLACE движок (паттерн Aider) ───────────────────────────────────
// ИИ возвращает только блоки изменений, мы применяем их к документу.
// Всё что не попало в блок — остаётся нетронутым (таблицы, реквизиты, форматирование).

interface EditBlock {
  search: string
  replace: string
}

/**
 * Парсит ответ ИИ на блоки SEARCH/REPLACE.
 * Формат:
 *   <<<<<<< SEARCH
 *   старый текст
 *   =======
 *   новый текст
 *   >>>>>>> REPLACE
 */
function parseEditBlocks(aiResponse: string): EditBlock[] {
  const blocks: EditBlock[] = []
  const re = /<{5,9}\s*SEARCH\s*\n([\s\S]*?)\n?={5,9}\s*\n([\s\S]*?)\n?>{5,9}\s*REPLACE/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(aiResponse)) !== null) {
    blocks.push({ search: m[1] ?? '', replace: m[2] ?? '' })
  }
  return blocks
}

/**
 * Нормализует строку (схлопывает пробелы) и строит карту индексов
 * норм-символ → оригинальный индекс. Для устойчивого нечёткого матчинга.
 */
function normalizeWithMap(str: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let prevSpace = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    if (/\s/.test(ch)) {
      if (!prevSpace && norm.length > 0) {
        norm += ' '
        map.push(i)
      }
      prevSpace = true
    } else {
      norm += ch
      map.push(i)
      prevSpace = false
    }
  }
  return { norm, map }
}

/**
 * Применяет один блок SEARCH/REPLACE к документу.
 * Многоуровневый матчинг: точный → без учёта пробелов.
 * Возвращает обновлённый документ или null если фрагмент не найден.
 */
function applyOneBlock(doc: string, block: EditBlock): string | null {
  const { search, replace } = block
  if (!search.trim()) return null

  // 1. Точное совпадение
  const exactIdx = doc.indexOf(search)
  if (exactIdx !== -1) {
    return doc.slice(0, exactIdx) + replace + doc.slice(exactIdx + search.length)
  }

  // 2. Нечёткое: без учёта различий в пробелах/переносах
  const { norm: docNorm, map: docMap } = normalizeWithMap(doc)
  const searchNorm = search.replace(/\s+/g, ' ').trim()
  if (!searchNorm) return null

  const normIdx = docNorm.indexOf(searchNorm)
  if (normIdx !== -1) {
    const origStart = docMap[normIdx]!
    const origEnd = docMap[normIdx + searchNorm.length - 1]! + 1
    return doc.slice(0, origStart) + replace + doc.slice(origEnd)
  }

  return null
}

/**
 * Применяет все блоки SEARCH/REPLACE к документу по очереди.
 * Возвращает результат + статистику применения.
 */
function applyEditBlocks(doc: string, aiResponse: string): {
  result: string
  applied: number
  failed: number
  failedSearches: string[]
} {
  const blocks = parseEditBlocks(aiResponse)
  let result = doc
  let applied = 0
  let failed = 0
  const failedSearches: string[] = []

  for (const block of blocks) {
    const updated = applyOneBlock(result, block)
    if (updated !== null) {
      result = updated
      applied++
    } else {
      failed++
      failedSearches.push(block.search.slice(0, 80))
    }
  }

  return { result, applied, failed, failedSearches }
}

// ─── Защита таблиц при AI-редактировании ─────────────────────────────────────

/**
 * Извлекает <table>...</table> из HTML и заменяет плейсхолдерами [TABLE_1] и т.д.
 * Возвращает: HTML с плейсхолдерами + массив исходных таблиц.
 *
 * Умеет определять вложенность: обрабатывает только таблицы верхнего уровня.
 */
function extractTables(html: string): { html: string; tables: string[] } {
  const tables: string[] = []
  let result = html
  let startIdx = 0

  // Ищем все <table> верхнего уровня (не вложенные)
  while (true) {
    const openIdx = result.indexOf('<table', startIdx)
    if (openIdx === -1) break

    // Находим конец этой таблицы, учитывая вложенность
    let depth = 0
    let i = openIdx
    let closeIdx = -1
    while (i < result.length) {
      if (result.slice(i, i + 6).toLowerCase() === '<table') {
        depth++
        i += 6
      } else if (result.slice(i, i + 8).toLowerCase() === '</table>') {
        depth--
        if (depth === 0) {
          closeIdx = i + 8
          break
        }
        i += 8
      } else {
        i++
      }
    }

    if (closeIdx === -1) break

    const tableHtml = result.slice(openIdx, closeIdx)
    const placeholder = `[TABLE_${tables.length + 1}]`
    tables.push(tableHtml)

    result = result.slice(0, openIdx) + placeholder + result.slice(closeIdx)
    startIdx = openIdx + placeholder.length
  }

  return { html: result, tables }
}

/**
 * Восстанавливает таблицы из плейсхолдеров [TABLE_N].
 */
function restoreTables(html: string, tables: string[]): string {
  let result = html
  tables.forEach((table, idx) => {
    const placeholder = `[TABLE_${idx + 1}]`
    // AI может изменить регистр или добавить пробелы — ищем по паттерну
    const re = new RegExp(`\\[TABLE_${idx + 1}\\]`, 'gi')
    result = result.replace(re, table)
  })
  return result
}

/**
 * Определяет, хочет ли пользователь изменить содержимое таблицы.
 */
function isTableEditInstruction(instruction: string): boolean {
  return /таблиц|прайс|цену?|стоимост|сумм|строк|колонк|ячейк|позиц/i.test(instruction)
}

/**
 * Конвертирует HTML-таблицу в текстовое представление для AI.
 * Формат: | ячейка1 | ячейка2 | ... |
 */
function tableToText(tableHtml: string): string {
  const rows: string[] = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = []
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      // Убираем вложенные теги, оставляем текст
      const text = cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      cells.push(text)
    }
    if (cells.length > 0) rows.push('| ' + cells.join(' | ') + ' |')
  }
  return rows.join('\n')
}

/**
 * Конвертирует текстовую таблицу (pipe-формат) обратно в HTML,
 * сохраняя структуру исходной HTML-таблицы.
 */
function textToTable(text: string, originalTableHtml: string): string {
  // Парсим текстовые строки
  const textRows = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .map(line =>
      line.slice(1, -1).split('|').map(cell => cell.trim())
    )

  if (textRows.length === 0) return originalTableHtml

  // Парсим структуру исходной таблицы (атрибуты ячеек, thead/tbody)
  const hasHead = /<thead/i.test(originalTableHtml)
  const origRows: Array<{ tag: string; cells: Array<{ tag: string; attrs: string }> }> = []
  const rowRe = /<(tr)([^>]*)>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(originalTableHtml)) !== null) {
    const cells: Array<{ tag: string; attrs: string }> = []
    const cellRe = /<(t[dh])([^>]*)>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[3])) !== null) {
      cells.push({ tag: cellMatch[1].toLowerCase(), attrs: cellMatch[2] })
    }
    origRows.push({ tag: rowMatch[1], cells })
  }

  // Получаем атрибуты <table>
  const tableAttrsMatch = originalTableHtml.match(/^<table([^>]*)>/i)
  const tableAttrs = tableAttrsMatch ? tableAttrsMatch[1] : ''

  // Собираем новую таблицу
  const htmlRows = textRows.map((cells, rowIdx) => {
    const origRow = origRows[rowIdx]
    return '<tr>' + cells.map((cellText, cellIdx) => {
      const origCell = origRow?.cells[cellIdx]
      const tag = origCell?.tag ?? 'td'
      const attrs = origCell?.attrs ?? ''
      return `<${tag}${attrs}>${cellText}</${tag}>`
    }).join('') + '</tr>'
  })

  if (hasHead && htmlRows.length > 0) {
    return `<table${tableAttrs}><thead>${htmlRows[0]}</thead><tbody>${htmlRows.slice(1).join('')}</tbody></table>`
  }
  return `<table${tableAttrs}><tbody>${htmlRows.join('')}</tbody></table>`
}

export const gigachatProvider: AIProvider = {
  async *chat(messages: AIMessage[], settings: AISettings, documentText: string) {
    const task = getPrimaryTask('chat')
    const payload = {
      model: getActiveModelId(task, GIGACHAT_MODEL),
      messages: toGigachatMessages(messages, settings, documentText),
      max_tokens: 32768,
      repetition_penalty: 1,
      temperature: getActiveTemperature(task, 0.4),
    }

    yield* streamText(payload, task)
  },

  async *editDocument(documentText: string, instruction: string, settings: AISettings) {
    // Подвал с реквизитами/подписями не отдаём в ИИ — правим только тело, подвал вернём как был.
    const { body: bodyDoc, requisites } = splitRequisitesBlock(documentText)
    const doc = bodyDoc
    const reattach = (html: string) => {
      const cleaned = splitRequisitesBlock(html).body
      return requisites ? `${cleaned.trimEnd()}\n${requisites}` : cleaned
    }

    // ── Таблично-специфичная правка ──────────────────────────────────────────
    // Модели на правку таблицы часто возвращают ТОЛЬКО изменённую строку <tr>,
    // а не всю таблицу. Блочный REPLACE такой голый <tr> отклоняет (невалиден
    // вне <table>), и правка «не находит фрагмент» (подтверждено: правка ячейки
    // таблицы падала и на DeepSeek, и на Qwen). Поэтому если задание про таблицу,
    // а в документе ровно ОДНА таблица — редактируем её отдельно: даём модели
    // только таблицу и просим вернуть её ЦЕЛИКОМ (простая задача → модель
    // отдаёт полную таблицу). Не вышло — падаем в общий блочный путь ниже.
    if (isTableEditInstruction(instruction)) {
      const { tables } = extractTables(doc)
      throw new Error(`TBLDBG2 tables=${tables.length} docLen=${doc.length} hasTableTag=${/<table/i.test(doc)} snip=${doc.slice(0, 140)}`)
      if (tables.length === 1) {
        const original = tables[0]!
        const origRows = (original.match(/<tr\b/gi) || []).length
        const sys = [
          'Ты редактируешь ОДНУ HTML-таблицу договора по заданию.',
          'Верни ТОЛЬКО обновлённую таблицу целиком: <table>…</table> со ВСЕМИ строками (и изменёнными, и неизменёнными), сохрани столбцы и структуру.',
          'Разрешены теги: table, thead, tbody, tr, th, td. ЗАПРЕЩЕНЫ markdown (**, |, #, ```), любые пояснения и текст вне <table>.',
          'Если задание меняет число — пересчитай зависимые ячейки: Сумма = Кол-во × Цена; строка ИТОГО = сумма всех строк.',
        ].join('\n')
        const usr = `Задание: ${instruction}\n\nТаблица:\n${original}`
        let resp = ''
        for await (const chunk of streamText({
          model: getActiveModelId('edit', GIGACHAT_MODEL),
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: usr },
          ],
          max_tokens: 8192,
          repetition_penalty: 1,
          temperature: getActiveTemperature('edit', 0.2),
        }, 'edit')) {
          resp += chunk
        }
        resp = resp.replace(/```\w*\s*/g, '').replace(/```/g, '').trim()
        const m = resp.match(/<table[\s\S]*<\/table>/i)
        if (m) {
          const newTable = m[0]
          const newRows = (newTable.match(/<tr\b/gi) || []).length
          const v = validateHtmlFragment(newTable)
          // Принимаем только валидную таблицу, которая не схлопнулась (строк не
          // меньше, чем было − 1). Иначе — общий путь.
          if (v.ok && newRows >= Math.max(2, origRows - 1)) {
            yield reattach(doc.replace(original, newTable))
            return
          }
          throw new Error(`TBLDBG hasTable=1 rows=${newRows}/${origRows} valid=${v.ok} vErr=${v.error ?? '-'} first=${newTable.slice(0, 120)}`)
        }
        throw new Error(`TBLDBG hasTable=0 respLen=${resp.length} first=${resp.slice(0, 160)}`)
      }
    }

    const allBlocks = splitHtmlBlocks(doc)

    // Для больших документов отправляем только релевантные блоки.
    // Находим блоки, содержащие ключевые слова из инструкции (топ-N слов ≥4 букв),
    // плюс 3 блока контекста вокруг каждого совпадения.
    const MAX_PROMPT_CHARS = 30000
    let blocks = allBlocks
    const fullText = blocksToPromptText(allBlocks)
    if (fullText.length > MAX_PROMPT_CHARS) {
      const keywords = instruction
        .toLowerCase()
        .replace(/[^\wА-яЁё\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4)
        .slice(0, 8)

      const relevant = new Set<number>()
      allBlocks.forEach((b, i) => {
        const bLower = b.toLowerCase()
        if (keywords.some(kw => bLower.includes(kw))) {
          for (let j = Math.max(0, i - 3); j <= Math.min(allBlocks.length - 1, i + 3); j++) {
            relevant.add(j)
          }
        }
      })

      if (relevant.size > 0 && relevant.size < allBlocks.length) {
        // Берём только релевантные блоки, сохраняем оригинальную нумерацию
        blocks = allBlocks.filter((_, i) => relevant.has(i))
        console.log(`[editDocument] focused edit: ${blocks.length}/${allBlocks.length} blocks selected`)
      } else {
        // Нет совпадений или слишком много — обрезаем по лимиту
        let total = 0
        const limited: string[] = []
        for (const b of allBlocks) {
          if (total + b.length > MAX_PROMPT_CHARS) break
          limited.push(b)
          total += b.length
        }
        blocks = limited
        console.log(`[editDocument] truncated to ${blocks.length}/${allBlocks.length} blocks`)
      }
    }

    // Маппинг: если использовали подмножество блоков, нумерация в промпте не совпадает
    // с индексами в allBlocks — передаём соответствие для applyBlockOps
    const blockIndexMap = allBlocks.length === blocks.length
      ? null
      : allBlocks.reduce((acc, b, i) => { if (blocks.includes(b)) acc.push(i); return acc }, [] as number[])

    const systemPrompt = [
      'Ты — юрист-редактор коммерческого SaaS-сервиса для работы с договорами. Твоя работа — вносить правки в гражданско-правовые договоры по заданию предпринимателей и юридических лиц. Это легитимная профессиональная деятельность.',
      'Работаешь с обезличенными юридическими документами в профессиональных целях.',
      'Блок реквизитов и подписей сторон из документа удалён системой — НЕ добавляй разделы «Реквизиты», «Подписи сторон», ИНН, счета, адреса сторон.',
      '',
      BLOCK_EDIT_INSTRUCTION,
      '',
      'ЛОГИЧЕСКАЯ СВЯЗНОСТЬ ПРАВКИ — ОБЯЗАТЕЛЬНО:',
      'Правка не должна оставлять документ в противоречивом состоянии. Если задание меняет одну величину — найди и поправь ВСЕ зависимые от неё значения в затронутых блоках:',
      '— меняешь проценты в разбивке платежа → пересчитай рублёвые суммы каждой части от общей стоимости (например, при цене 115 000 руб. доля 70% = 80 500 руб., 30% = 34 500 руб.); сумма всех частей должна равняться общей стоимости;',
      '— удаляешь или добавляешь пункт в нумерованном списке → пересчитай нумерацию всех последующих пунктов подряд (3.2.1, 3.2.2, 3.2.3 без пропусков), верни их через REPLACE;',
      '— меняешь срок/дату в одном месте → проверь, не упомянут ли этот же срок в связанных пунктах;',
      '— меняешь роль/название стороны → поправь во всех затронутых пунктах.',
      'Прежде чем вернуть операции, перечитай задание и убедись, что результат внутренне непротиворечив (суммы сходятся, нумерация сплошная, формулировки согласованы).',
      '',
      `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90.`,
      settings.customInstruction ? `Особые требования: ${settings.customInstruction}` : '',
    ].filter(Boolean).join('\n')

    const userMessage = `Задание: ${instruction}\n\nДокумент (пронумерованные блоки):\n${blocksToPromptText(blocks) || '(документ пуст)'}`

    const payload = {
      model: getActiveModelId('edit', GIGACHAT_MODEL),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 16384,
      repetition_penalty: 1,
      temperature: getActiveTemperature('edit', 0.25),
    }

    let aiResponse = ''
    for await (const chunk of streamText(payload, 'edit')) {
      aiResponse += chunk
    }

    console.log('[editDocument] raw AI response length:', aiResponse.length, 'first 200:', aiResponse.slice(0, 200))

    // Предохранитель от разрушительных правок: если результат внезапно стал
    // кардинально короче оригинала — это почти наверняка ошибка модели
    // (спутала диапазон блоков и стёрла полдоговора), а не настоящая команда
    // «удали половину текста». Такую правку отклоняем, документ не трогаем.
    // Текстовая длина (без HTML-тегов) — теги могут раздувать разницу.
    const plainLen = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
    const originalLen = plainLen(doc)
    const looksDestructive = (resultHtml: string): boolean => {
      if (originalLen < 400) return false // короткие документы не проверяем
      return plainLen(resultHtml) < originalLen * 0.5
    }

    // ── Основной путь: блочные операции ──
    // Если ИИ процитировал anchor — applyBlockOps найдёт блок по содержимому
    // сам, независимо от номера. Если anchor нет (или не нашёлся) — нужен
    // номер именно в системе координат allBlocks, поэтому переводим номера
    // из промпта (1-based в subset) обратно в полный массив заранее.
    const ops = parseBlockOps(aiResponse)
    if (ops.length > 0) {
      const opsForAllBlocks = blockIndexMap
        ? ops.map(op => ({
            ...op,
            from: blockIndexMap[op.from - 1] !== undefined ? blockIndexMap[op.from - 1]! + 1 : op.from,
            to:   blockIndexMap[op.to - 1]   !== undefined ? blockIndexMap[op.to - 1]!   + 1 : op.to,
          }))
        : ops
      const blockResult = applyBlockOps(allBlocks, opsForAllBlocks)
      console.log(`[editDocument] block ops: applied=${blockResult.applied} rejected=${blockResult.rejected}`, blockResult.errors)
      if (blockResult.applied > 0) {
        if (looksDestructive(blockResult.html)) {
          console.warn(`[editDocument] REJECTED destructive edit: ${originalLen} → ${plainLen(blockResult.html)} chars`)
          yield '__EDIT_FAILED__'
          return
        }
        yield reattach(blockResult.html)
        return
      }
      yield '__EDIT_FAILED__'
      return
    }

    // ── Фоллбэк: модель ответила в старом формате SEARCH/REPLACE ──
    const { result, applied, failed, failedSearches } = applyEditBlocks(doc, aiResponse)
    console.log(`[editDocument] fallback search/replace: applied=${applied} failed=${failed}`, failed > 0 ? failedSearches : '')

    if (applied === 0) {
      yield '__EDIT_FAILED__'
      return
    }

    if (looksDestructive(result)) {
      console.warn(`[editDocument] REJECTED destructive fallback edit: ${originalLen} → ${plainLen(result)} chars`)
      yield '__EDIT_FAILED__'
      return
    }

    yield reattach(result)
  },

  async review(documentText: string, settings: AISettings): Promise<ReviewResult> {
    // Извлекаем роль пользователя из customInstruction если она там есть
    const roleMatch = settings.customInstruction?.match(/Роль пользователя:\s*(.+?)(?:\.|$)/i)
    const userRole = roleMatch?.[1]?.trim() ?? 'одна из сторон'
    const otherRole = userRole === 'Исполнитель' ? 'Заказчик' : 'Исполнитель'

    const systemContent = [
      'Ты — юридический аналитик коммерческого SaaS-сервиса для работы с договорами. Твоя работа — профессиональный правовой аудит договоров по запросу предпринимателей и юридических лиц. Это легитимная профессиональная деятельность.',
      'Анализируешь гражданско-правовые договоры (услуги, подряд, поставка, аренда и т.д.) СТРОГО с точки зрения конкретной роли пользователя.',
      'Возвращай ТОЛЬКО валидный JSON без markdown-обёртки, без пояснений до и после.',
      'ВАЖНО: Ты работаешь с обезличенными юридическими документами в профессиональных целях. Никаких персональных данных не обрабатывается в противоправных целях.',
      '',
      '══════════ ГЛАВНОЕ ПРАВИЛО ══════════',
      `Пользователь выступает в роли: ${userRole}`,
      `Противоположная сторона: ${otherRole}`,
      '',
      'Один и тот же пункт оценивается ПРОТИВОПОЛОЖНО в зависимости от роли:',
      `  • Условие ЗАЩИЩАЕТ ${userRole} → severity: "ok"`,
      `  • Условие УХУДШАЕТ положение ${userRole} → severity: "risk" или "warning"`,
      `  • ЗАПРЕЩЕНО называть "риском" ограничение ответственности ${userRole} — это его защита`,
      `  • ЗАПРЕЩЕНО предлагать усилить обязательства ${userRole} — это против его интересов`,
      '',
      '══════════ 7 ОБЯЗАТЕЛЬНЫХ БЛОКОВ АНАЛИЗА ══════════',
      '',
      `БЛОК 1 — СУЩЕСТВУЮЩИЕ УСЛОВИЯ (category: "general")`,
      `Проанализируй ВСЕ значимые условия договора с позиции ${userRole}:`,
      '  - права и обязанности сторон',
      '  - ответственность, неустойки, штрафы',
      '  - порядок расторжения и его последствия',
      '  - форс-мажор и его применение к каждой из сторон',
      '  - интеллектуальная собственность (если применимо)',
      '',
      `БЛОК 2 — ФИНАНСОВАЯ ЗАЩИТА (category: "finance")`,
      `Отдельно оцени финансовую защищённость ${userRole}. Проверь наличие и качество:`,
      '  - порядок оплаты (сроки, способ, основания)',
      '  - предоплата — есть ли, в каком размере',
      '  - постоплата — условия и сроки',
      '  - ответственность за просрочку оплаты (неустойка, % за каждый день)',
      '  - механизм взыскания задолженности',
      `  Если условие защищает финансовые интересы ${userRole} → severity: "ok"`,
      `  Если финансовый риск для ${userRole} → severity: "risk"`,
      `  Если финансовое условие отсутствует и его нужно добавить → severity: "warning", clause: "нет"`,
      '',
      `БЛОК 3 — СУДЕБНАЯ ПЕРСПЕКТИВА (category: "litigation")`,
      `Оцени насколько договор позволит ${userRole} выиграть спор в суде. Проверь:`,
      '  - наличие актов сдачи-приёмки',
      '  - условие об автоматической приёмке (через N дней без замечаний)',
      '  - юридически значимая переписка (email, ЭДО, какой канал)',
      '  - доказуемость выполнения обязательств',
      '  - подсудность (в каком суде рассматриваются споры, договорная подсудность)',
      '  - претензионный порядок (срок ответа на претензию)',
      `  Если условие помогает ${userRole} в суде → severity: "ok"`,
      `  Если отсутствует важный для суда пункт → severity: "warning" или "risk", clause: "нет"`,
      '',
      `БЛОК 4 — ВОЗМОЖНОСТЬ ЗЛОУПОТРЕБЛЕНИЙ (category: "abuse")`,
      `Проверь может ли ${otherRole} злоупотребить условиями договора. Ищи:`,
      '  - бесконечные правки без ограничений по количеству и срокам',
      '  - необоснованный отказ от приёмки без чётких критериев',
      '  - право отказаться от оплаты при спорных основаниях',
      '  - право в одностороннем порядке изменять ТЗ, объём, условия',
      '  - право на одностороннее расторжение без компенсации',
      `  Если злоупотребление возможно и это невыгодно ${userRole} → severity: "risk", importance: "high"`,
      `  Если есть ограничители злоупотреблений → severity: "ok"`,
      '',
      `БЛОК 5 — ОТСУТСТВУЮЩИЕ УСЛОВИЯ (category: "missing")`,
      `Выяви важные ОТСУТСТВУЮЩИЕ условия, которые усилили бы защиту ${userRole}:`,
      '  Для каждого отсутствующего условия:',
      '    clause: "нет"',
      '    severity: "warning" или "risk" (в зависимости от критичности)',
      '    recommendation: "Добавить"',
      `    description: "Условие отсутствует. Рекомендуется добавить: [конкретная формулировка]"`,
      '  Примеры типичных пропусков: ограничение кол-ва правок, автоматическая приёмка,',
      '  юридически значимая переписка, порядок передачи результата, запрет переуступки,',
      '  ответственность за разглашение конфиденциальных данных.',
      '',
      `БЛОК 6 — ПРОТИВОРЕЧИЯ (category: "general")`,
      'Проверь наличие внутренних противоречий в договоре:',
      '  - противоречия между разделами (например, срок в разд.2 vs срок в разд.4)',
      '  - условия, которые нивелируют друг друга',
      '  - ссылки на несуществующие приложения или пункты',
      `  Противоречие, вредящее ${userRole} → severity: "risk"`,
      `  Противоречие нейтральное → severity: "warning"`,
      '',
      `БЛОК 7 — БАЛАНС ИНТЕРЕСОВ (category: "general")`,
      'Оцени в целом: в чьих интересах составлен договор.',
      `  Условие явно защищает ${otherRole} → severity: "warning", укажи это прямо`,
      `  Условие явно защищает ${userRole} → severity: "ok"`,
      '',
      // Орфография теперь считается отдельным запросом — здесь не нужна

      '══════════ УРОВЕНЬ ЗНАЧИМОСТИ (importance) ══════════',
      'high   — критично для финансов, репутации или судебной перспективы',
      'medium — важно, но не критично',
      'low    — рекомендация по улучшению',
      '',
      '══════════ ЗАПРЕЩЕНО ══════════',
      `  ✗ Предлагать усилить ответственность ${userRole}`,
      `  ✗ Называть "риском" защитные клаузулы ${userRole}`,
      '  ✗ Общие фразы без конкретики ("рекомендуем уточнить")',
      '  ✗ Игнорировать отсутствующие условия',
      '',
      'Ссылки на ГК РФ (ст. 330, 401, 421, 450, 723 и т.д.) где уместно.',
    ].join('\n')

    const prompt = [
      'Проверь договор и верни JSON строго в следующем формате:',
      '{',
      '  "score": 58,',
      `  "summary": "3-4 предложения: (1) тип договора; (2) в чьих интересах составлен — прямо назови сторону; (3) насколько хорошо защищает ${userRole} — конкретно; (4) главные условия которые нужно усилить или добавить.",`,
      '  "spellCount": 3,',
      '  "issues": [',
      '    {',
      '      "id": "1",',
      '      "severity": "risk",',
      '      "importance": "high",',
      '      "category": "abuse",',
      `      "title": "Заказчик может требовать правки бесконечно",`,
      `      "description": "П. 4.3 не ограничивает количество итераций правок и срок их внесения. На практике это позволяет Заказчику затягивать приёмку неограниченно долго и уклоняться от оплаты. Рекомендуется: добавить '…не более 3 итераций правок в течение 5 рабочих дней каждая'.",`,
      '      "clause": "п. 4.3",',
      '      "recommendation": "Исправить"',
      '    },',
      '    {',
      '      "id": "2",',
      '      "severity": "warning",',
      '      "importance": "high",',
      '      "category": "missing",',
      '      "title": "Отсутствует автоматическая приёмка",',
      `      "description": "Условие об автоматической приёмке отсутствует. Без него Заказчик может молчать и не подписывать акт — Исполнитель не получит оплату и не докажет факт сдачи работ. Рекомендуется добавить: 'Если в течение 5 рабочих дней после передачи результата Заказчик не подписал акт и не направил письменный мотивированный отказ, работы считаются принятыми'.",`,
      '      "clause": "нет",',
      '      "recommendation": "Добавить"',
      '    }',
      '  ]',
      '}',
      '',
      '═══ ПРАВИЛА ═══',
      `score: 0..100 — оценка ИМЕННО с позиции ${userRole} (100 = максимально выгоден ${userRole})`,
      'spellCount: число ошибок из отдельной проверки орфографии (подставляется программно, пиши 0)',
      'issues: от 10 до 18 пунктов — охватывай ВСЕ 7 блоков анализа, не только общие условия',
      'severity: risk / warning / ok / neutral',
      'importance: high / medium / low',
      'category: "general" | "finance" | "litigation" | "abuse" | "missing"',
      'recommendation: "Оставить" | "Усилить" | "Исправить" | "Добавить" | "Нейтрально"',
      `Минимум 3 пункта severity:"ok" — реальные защитные условия ${userRole}`,
      `Минимум 2 пункта category:"missing" — отсутствующие условия которых нет в тексте`,
      `Минимум 1 пункт category:"finance" и минимум 1 пункт category:"litigation"`,
      `Минимум 1 пункт category:"abuse" — возможность злоупотребления со стороны ${otherRole}`,
      `clause: точный номер ("п. 3.2") или "нет" если пункт отсутствует`,
      '',
      settings.customInstruction ? `Дополнительный контекст: ${settings.customInstruction}\n` : '',
      'Текст договора:',
      documentText || '(пустой текст — укажи в summary что документ пуст, score=0, 1 issue severity=risk)',
    ].filter(Boolean).join('\n')

    // GigaChat-2 для review: контекст ~32К токенов ≈ 40К символов текста документа.
    // Для больших документов умно обрезаем: сохраняем основной договор,
    // отсекаем типовые приложения/регламенты которые обычно идут в конце.
    const MAX_DOC_CHARS = 40_000
    let docForReview = documentText
    if (documentText.length > MAX_DOC_CHARS) {
      // Пробуем найти конец основного договора (начало приложений)
      const appendixStart = documentText.search(
        /\n(ПРИЛОЖЕНИЕ|Приложение|ПРИЛОЖЕНИЕ\s*№|Приложение\s*№|РЕГЛАМЕНТ|Регламент)\s*[№\d]/
      )
      if (appendixStart > 10_000 && appendixStart < MAX_DOC_CHARS) {
        // Берём основной договор + уведомление об обрезке
        docForReview = documentText.slice(0, appendixStart) +
          '\n\n[Приложения к договору не включены в анализ — анализируется основной текст договора]'
      } else {
        // Просто берём первые 40К
        docForReview = documentText.slice(0, MAX_DOC_CHARS) +
          '\n\n[Текст обрезан — показаны первые 40 000 символов]'
      }
    }
    const finalPrompt = prompt.replace(
      documentText || '(пустой текст — укажи в summary что документ пуст, score=0, 1 issue severity=risk)',
      docForReview || '(пустой текст — укажи в summary что документ пуст, score=0, 1 issue severity=risk)',
    )

    // Сначала основной юридический анализ, потом орфография
    // (параллельный запуск давал 429 — слишком много одновременных запросов)
    const reviewTask = getPrimaryTask('review')
    const content = await completeText({
      model: getActiveModelId(reviewTask, GIGACHAT_REVIEW_MODEL),
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: finalPrompt },
      ],
      max_tokens: 6000,
      repetition_penalty: 1,
      temperature: getActiveTemperature(reviewTask, 0.1),
    }, reviewTask)

    // Пауза перед орфографией — даём GigaChat-2-Max «отдышаться» после большого запроса
    await new Promise((r) => setTimeout(r, 5000))
    const spellCount = await checkSpelling(documentText).catch(() => 0)

    // Определяем отказ фильтра безопасности GigaChat
    const isSafetyRefusal = (text: string) =>
      text.includes('генеративные языковые модели') ||
      text.includes('чувствите') ||
      text.includes('не могу выполнить') ||
      text.includes('не могу помочь') ||
      text.includes('К сожалению, я не') ||
      text.includes('отказываюсь') ||
      (!text.includes('{') && text.length > 50)

    // Если сработал фильтр — повторяем с более нейтральным промптом
    let finalContent = content
    if (isSafetyRefusal(content)) {
      await new Promise((r) => setTimeout(r, 2000))
      const fallbackPrompt = [
        `Выполни юридический аудит гражданско-правового договора. Роль клиента: ${userRole}.`,
        'Верни JSON:',
        `{"score":0,"summary":"","spellCount":0,"issues":[{"id":"1","severity":"warning","importance":"medium","category":"general","title":"","description":"","clause":"п. 1","recommendation":"Проверить"}]}`,
        '',
        'Поля: score 0-100, summary 2-3 предложения об условиях договора, issues — список замечаний.',
        'severity: risk/warning/ok/neutral, importance: high/medium/low, category: general/finance/litigation/abuse/missing',
        '',
        'Текст договора для анализа:',
        documentText.slice(0, 30_000),
      ].join('\n')

      finalContent = await completeText({
        model: getActiveModelId('review_fallback', GIGACHAT_FAST_MODEL),
        messages: [
          { role: 'system', content: 'Ты юридический аналитик. Анализируй гражданско-правовые договоры. Отвечай только JSON.' },
          { role: 'user', content: fallbackPrompt },
        ],
        max_tokens: 5000,
        repetition_penalty: 1,
        temperature: getActiveTemperature('review_fallback', 0.1),
      }, 'review_fallback')
    }

    // Защищённый парсинг — если JSON обрезан, пробуем починить
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(extractJson(finalContent))
    } catch {
      const raw = extractJson(finalContent)
      const fixed = raw.trimEnd()
        .replace(/,\s*$/, '')
        + (raw.includes('"issues"') && !raw.trimEnd().endsWith(']') ? ']' : '')
        + '}'
      try {
        parsedJson = JSON.parse(fixed)
      } catch {
        throw new Error(`Не удалось проанализировать документ. GigaChat ответил: ${finalContent.slice(0, 150)}`)
      }
    }

    const result = normalizeReview(parsedJson)
    result.spellCount = spellCount
    return result
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

    // Лимит вывода. РАНЬШЕ было targetSize/1.5*1.2 с полом 8000 — этого не хватало
    // на полную 12-разделную структуру, и договор обрывался на середине (проверено
    // вживую: цель 8000 знаков → обрыв на п.3, разделы 4-12 отсутствовали).
    // Русский токенайзер даёт ~1.2 символа/токен в худшем случае — считаем по нему
    // и добавляем 40% запас, чтобы все требуемые разделы гарантированно уместились.
    // Пол 12000 токенов: полная структура должна помещаться даже для короткого
    // договора. Потолок 32768 — максимум вывода модели.
    const estimatedTokens = Math.ceil(settings.targetSize / 1.2 * 1.4)
    const maxTokens = Math.min(Math.max(estimatedTokens, 12000), 32768)

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
        '6. Верни ТОЛЬКО HTML-текст заполненного договора — без пояснений. Заголовки разделов: <h2>, пункты: <p>, таблицы: <table>. ЗАПРЕЩЕНО markdown.',
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
        model: getActiveModelId('generate', GIGACHAT_MODEL),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        repetition_penalty: 1.0,
        temperature: getActiveTemperature('generate', 0.2),
      }, 'generate')
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
          'ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ К НУМЕРАЦИИ И ФОРМАТУ HTML:',
          'Каждый раздел — тег <h2> + пункты в тегах <p>. Пример:',
          '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
          '<p>1.1. Исполнитель обязуется оказать услуги.</p>',
          '<p>1.2. Результатом оказания услуг является...</p>',
          '<p>1.3. Услуги оказываются по адресу...</p>',
          '',
          '<h2>2. ПРАВА И ОБЯЗАННОСТИ СТОРОН</h2>',
          '<p>2.1. Исполнитель обязан:</p>',
          '<p>2.1.1. выполнить работу в срок;</p>',
          '<p>2.1.2. предоставить результат.</p>',
          '<p>2.2. Заказчик обязан:</p>',
          '<p>2.2.1. оплатить услуги;</p>',
          '',
          'ЗАПРЕЩЕНО: markdown-символы (**, *, #). Каждый пункт — отдельный <p>.',
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
          'ФОРМАТИРОВАНИЕ — СТРОГО HTML: заголовки разделов в <h2>, пункты в <p>, таблицы в <table>. Нумерация 1.1. 1.2. в тексте <p>. ЗАПРЕЩЕНО использовать markdown-символы. ЗАПРЕЩЕНО inline-стили.',
        ].join('\n')
      : [
          '=== ФОРМАТ ВЫВОДА — HTML, СОБЛЮДАТЬ СТРОГО ===',
          'Договор состоит из разделов. Каждый раздел — это <h2>заголовок</h2> + пункты в <p>.',
          'Подпункты нумеруются через точку: 1.1. 1.2. 1.3. — для раздела 1; 2.1. 2.2. — для раздела 2.',
          'Каждый пункт и подпункт — отдельный тег <p>. ЗАПРЕЩЕНО несколько пунктов в одном <p>.',
          'ЗАПРЕЩЕНО: markdown-символы (**, *, #, -, >), маркированные списки.',
          'ЗАПРЕЩЕНО: нумеровать подпункты как (1., 2., 3.) внутри раздела — только 2.1., 2.2., 2.3.',
          'ЗАПРЕЩЕНО: римские цифры (I., II., III.) — ТОЛЬКО арабские: 1., 2., 3.',
          'ЗАПРЕЩЕНО: выделять преамбулу как раздел. Преамбула — вводный <p> перед первым <h2>.',
          'ЗАПРЕЩЕНО: блоки ```html и ```. Возвращай ТОЛЬКО HTML-код.',
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
          'ФОРМАТИРОВАНИЕ — СТРОГО HTML: заголовки разделов в <h2>, пункты в <p>, таблицы в <table>. Нумерация (1.1., 1.2.) пишется в тексте внутри <p>. ЗАПРЕЩЕНО markdown-символы (**, *, #). ЗАПРЕЩЕНО inline-стили. ЗАПРЕЩЕНО нумеровать разделы римскими цифрами.',
        ].join('\n')

    const protectionNote = settings.protectionLevel >= 60
      ? `Уровень защиты интересов «${role1}»: ${settings.protectionLevel}/90 (ВЫСОКИЙ). Максимально защити позицию «${role1}»: повышенные неустойки в его пользу, расширенные права, ограниченная ответственность «${role1}» за косвенные убытки, жёсткие обязательства «${role2}».`
      : settings.protectionLevel >= 30
      ? `Уровень защиты: ${settings.protectionLevel}/90 (СБАЛАНСИРОВАННЫЙ). Договор защищает обе стороны примерно поровну, разумные санкции.`
      : `Уровень защиты: ${settings.protectionLevel}/90 (НЕЙТРАЛЬНЫЙ). Минимальные неустойки, симметричные права и обязанности.`

    const userPrompt = [
      parentSnippet ? `ОСНОВНОЙ ДОГОВОР (используй его условия, стороны и терминологию как базу — создаваемый документ является приложением/ДС к нему):\n---\n${parentSnippet}\n---\n` : '',
      referenceSnippet ? `ОБРАЗЕЦ ДОКУМЕНТА (изучи его тип, сферу, стиль защиты и логику условий — адаптируй под новое задание сохраняя эти принципы):\n---\n${referenceSnippet}\n---\n` : '',
      headerBlock
        ? isChildDoc
          // Для приложений/ДС преамбулы нет — но ИИ нужно знать точные ФИО/роли для ссылок на стороны в тексте.
          ? `ДАННЫЕ СТОРОН (для контекста — точные ФИО, ИНН, роли; НЕ пиши их отдельным абзацем-преамбулой):\n${headerBlock}`
          // Для основного договора преамбулу пишет система — ИИ передаём данные только для контекста.
          : `ДАННЫЕ СТОРОН (для контекста — НЕ пиши преамбулу/вводный абзац сам, система вставит её автоматически из этих данных):\n${headerBlock}`
        : `Стороны: Пользователь («${role1}») и "${counterpartyName}" («${role2}»).`,
      '',
      `ЗАДАЧА: ${description || 'составить договор между сторонами'}`,
      '',
      isChildDoc ? `ЖЁСТКОЕ ТРЕБОВАНИЕ: этот документ — приложение/доп.соглашение к договору выше. Ссылайся на его конкретные пункты (например: «в соответствии с п. 3.1 Договора»). НЕ дублируй полный текст основного договора. Только дополняй или изменяй конкретные условия.` : '',
      protectionNote,
      `ЦЕЛЕВОЙ ОБЪЁМ: около ${settings.targetSize} знаков. Это ОРИЕНТИР, а не жёсткий минимум.`,
      'КРИТИЧЕСКИ ВАЖНО — ПОЛНОТА ВАЖНЕЕ ДЛИНЫ: ОБЯЗАТЕЛЬНО заверши ВСЕ разделы структуры до конца, включая последний. НЕ ссылайся на разделы/пункты, которых нет в документе. Если приближаешься к пределу — делай пункты короче, но НЕ обрывай договор и НЕ заканчивай предложение на середине. Документ всегда завершается разделом «Заключительные положения».',
      settings.customInstruction ? `\nОБЯЗАТЕЛЬНЫЕ ДОПОЛНИТЕЛЬНЫЕ УСЛОВИЯ (включить в текст договора):\n${settings.customInstruction}` : '',
      '\n⛔ СТОП — КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: добавлять раздел «Реквизиты сторон», «Место нахождения», «Банковские реквизиты», «Подписи сторон» или любой аналог. НЕ пиши ИНН, КПП, ОГРН, расчётные счета, БИК, адреса в конце договора. Система автоматически добавит реквизиты при скачивании. Последний раздел договора — «Заключительные положения» или «Прочие условия». После него ничего.',
      '\nЯзык: только русский.',
      '\n=== ОБЯЗАТЕЛЬНЫЙ ФОРМАТ — HTML ===',
      'Возвращай ТОЛЬКО HTML. ЗАПРЕЩЕНО markdown-символы (**, *, #).',
      '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
      '<p>1.1. Исполнитель обязуется...</p>',
      '<p>1.2. Результатом является...</p>',
      '',
      '<h2>2. ПРАВА И ОБЯЗАННОСТИ СТОРОН</h2>',
      '<p>2.1. Исполнитель обязан:</p>',
      '<p>2.1.1. выполнить...</p>',
      '<p>2.2. Заказчик обязан:</p>',
      '<p>2.2.1. оплатить...</p>',
      '',
      'ЗАПРЕЩЕНО: "1.", "2." как подпункты — только "2.1.", "2.2."',
      'ЗАПРЕЩЕНО: markdown-списки, блоки ```.',
      'Минимум 5 подпунктов <p> в каждом разделе.',
    ].filter(Boolean).join('\n')

    yield* streamText({
      model: getActiveModelId('generate', GIGACHAT_MODEL),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      repetition_penalty: 1.05,
      temperature: getActiveTemperature('generate', 0.4),
    }, 'generate')
  },

  async extractParties(documentText: string) {
    const systemContent = [
      'Ты юридический парсер. Твоя задача — извлечь реквизиты сторон договора из текста.',
      'Возвращай ТОЛЬКО валидный JSON без markdown-обёртки, без пояснений.',
    ].join('\n')

    const prompt = [
      'Извлеки реквизиты обеих сторон договора и верни строго в формате:',
      '{',
      '  "docTitle": "Договор оказания услуг №1 от 01.01.2024",',
      '  "party1": {',
      '    "name": "ООО \\"Ромашка\\"",',
      '    "type": "ООО",',
      '    "role": "customer",',
      '    "inn": "7712345678",',
      '    "kpp": "771201001",',
      '    "ogrn": "1027700000001",',
      '    "legalAddress": "г. Москва, ул. Ленина, д. 1",',
      '    "bankName": "ПАО Сбербанк",',
      '    "bik": "044525225",',
      '    "checkingAccount": "40702810000000000001",',
      '    "correspondentAccount": "30101810400000000225",',
      '    "signatorName": "Иванов Иван Иванович",',
      '    "signatorPosition": "Генеральный директор",',
      '    "signatorBasis": "Устав"',
      '  },',
      '  "party2": { /* аналогично, "role": "executor" */ }',
      '}',
      '',
      'Правила:',
      '- Если реквизит не найден — ставь null',
      '- type: "ООО", "АО", "ПАО", "ЗАО", "ИП", "АНО" или "Физлицо"',
      '- role: "customer" (Заказчик) или "executor" (Исполнитель/Подрядчик/Поставщик) — определяй по тексту договора. Кто платит — customer, кто выполняет — executor.',
      '- Для ИП в поле name пиши полностью: "ИП Иванов Иван Иванович"',
      '- docTitle: первое найденное название договора в документе, или null',
      '- Не придумывай данные — только то что есть в тексте',
      '',
      'Текст договора:',
      documentText.slice(0, 6000), // берём первые 6000 символов где обычно реквизиты
    ].join('\n')

    const content = await completeText({
      model: getActiveModelId('extract_parties', GIGACHAT_FAST_MODEL),
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1500,
      repetition_penalty: 1,
      temperature: getActiveTemperature('extract_parties', 0.1),
    }, 'extract_parties')

    const raw = JSON.parse(extractJson(content))

    // Нормализуем — гарантируем наличие party1 и party2
    return {
      docTitle: raw.docTitle ?? null,
      party1: raw.party1 ?? { name: 'Сторона 1' },
      party2: raw.party2 ?? { name: 'Сторона 2' },
    }
  },
}
