// ─── Интерфейс ИИ-провайдера ─────────────────────────────────────────────────
// Одна реализация под Claude, другая под OpenAI — выбор через env AI_PROVIDER

/** Данные профиля пользователя (Исполнитель/одна из сторон) для подстановки в договор */
export interface UserProfileData {
  type: string          // SOLE_PROPRIETOR | COMPANY | INDIVIDUAL | ANO | PAO | ZAO
  name: string          // Полное наименование
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  ogrnDate?: string | null
  legalAddress?: string | null
  signatorName?: string | null
  signatorPosition?: string | null
  signatorBasis?: string | null
  bankName?: string | null
  checkingAccount?: string | null
  bik?: string | null
  correspondentAccount?: string | null
  email?: string | null
}

/** Данные контрагента для подстановки в шапку и реквизиты договора */
export interface CounterpartyData {
  name: string
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  email?: string | null
  phone?: string | null
  bankName?: string | null
  checkingAccount?: string | null
  bik?: string | null
  correspondentAccount?: string | null
  signatorName?: string | null
  signatorPosition?: string | null
  signatorBasis?: string | null   // "Устав" | "Доверенность №..." | ОГРНИП №...
}

export interface AISettings {
  protectionLevel: number  // 20-90
  targetSize: number       // знаков
  customInstruction: string
  // Роль пользователя в договоре, резолвится сервером через resolvePartyRole
  // (party-roles.ts) — единый источник истины. Провайдер использует её с
  // приоритетом над разбором customInstruction.
  userRoleName?: 'Заказчик' | 'Исполнитель'
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ReviewIssue {
  id: string
  severity: 'risk' | 'warning' | 'ok' | 'neutral'
  importance: 'high' | 'medium' | 'low'   // Высокий / Средний / Низкий
  title: string
  description: string
  clause: string        // "п. 7.5" / "разд. 4" / "нет" (если пункт отсутствует)
  recommendation?: string  // "Оставить", "Усилить", "Исправить", "Добавить", "Нейтрально"
  category?: string    // "finance" | "litigation" | "abuse" | "missing" | "general"
}

export interface ReviewResult {
  score: number           // 0-100
  riskCount: number
  warningCount: number
  okCount: number
  spellCount: number      // орфографические + пунктуационные ошибки
  issues: ReviewIssue[]
  summary: string
}

/**
 * Результат редактирования документа через ИИ.
 * updatedDocument — полный новый текст документа (применены изменения).
 * explanation — краткое пояснение что изменил (для чат-сообщения).
 */
export interface EditResult {
  updatedDocument: string
  explanation: string
}

/** Данные стороны договора, извлечённые из текста */
export interface ExtractedParty {
  name: string
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  bankName?: string | null
  bik?: string | null
  checkingAccount?: string | null
  correspondentAccount?: string | null
  signatorName?: string | null
  signatorPosition?: string | null
  signatorBasis?: string | null  // «Устав», «Доверенность №...» и т.д.
  type?: string | null           // «ООО» | «ИП» | «АО» | «Физлицо» и т.д.
  role?: 'customer' | 'executor' | null  // роль в договоре по тексту документа
}

export interface ExtractPartiesResult {
  party1: ExtractedParty   // первая сторона в договоре
  party2: ExtractedParty   // вторая сторона в договоре
  docTitle?: string | null // название договора, если найдено
}

export interface AIProvider {
  /** Стриминг ответа в чате (только текстовый ответ, без изменения документа) */
  chat(
    messages: AIMessage[],
    settings: AISettings,
    documentText: string,
  ): AsyncGenerator<string>

  /**
   * Редактирует документ по инструкции.
   * Стримит обновлённый текст документа.
   * После завершения возвращает краткое объяснение через done-событие.
   */
  editDocument(
    documentText: string,
    instruction: string,
    settings: AISettings,
  ): AsyncGenerator<string>

  /** Проверка документа на риски */
  review(documentText: string, settings: AISettings): Promise<ReviewResult>

  /** Извлечение реквизитов сторон из текста договора */
  extractParties(documentText: string): Promise<ExtractPartiesResult>

  /**
   * Определяет, какие из строк-кандидатов — заголовки документа.
   * Возвращает индекс названия (title) и индексы разделов (headings) в переданном
   * массиве. Текст НЕ меняется — только классификация по индексам.
   */
  detectHeadings(candidates: string[]): Promise<{ title: number | null; headings: number[] }>

  /** Генерация первого черновика */
  generate(
    description: string,
    counterpartyName: string,
    settings: AISettings,
    userProfile?: UserProfileData,
    counterpartyData?: CounterpartyData,
    parentDocContent?: string,   // полный текст родительского договора (для APPENDIX/AMENDMENT)
    referenceContent?: string,   // образец документа (шаблон/загруженный файл)
    base?: string,               // 'scratch' | 'template' | 'upload' — влияет на режим генерации
    userRole?: 'customer' | 'executor',  // роль пользователя в договоре
    city?: string,                        // город подписания
    signingDate?: string,                 // дата подписания (ISO)
  ): AsyncGenerator<string>
}
