/**
 * Единый конфиг токеновой экономики.
 * Все цены целые, переопределяются через ENV (TOKEN_PRICE_*).
 * Клиентские компоненты цены получают из API — этот модуль серверный,
 * но чистые функции (calcEditLimit, formatTokens) можно импортировать где угодно.
 */

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback
}

export const TOKEN_PRICES = {
  /** Генерация с нуля: договор / приложение / допсоглашение */
  generate: envInt('TOKEN_PRICE_GENERATE', 100),
  /** Старт правок загруженного документа (первая правка через чат) */
  uploadEditStart: envInt('TOKEN_PRICE_UPLOAD_EDIT_START', 50),
  /** «Переписать заново» загруженный документ */
  rewrite: envInt('TOKEN_PRICE_REWRITE', 100),
  /** Докупка пакета правок после исчерпания */
  editPackage: envInt('TOKEN_PRICE_EDIT_PACKAGE', 100),
  /** Проверка на риски — за каждый запуск */
  review: envInt('TOKEN_PRICE_REVIEW', 25),
  /** Анализ при загрузке файла — за каждый анализ */
  analyzeUpload: envInt('TOKEN_PRICE_ANALYZE_UPLOAD', 25),
} as const

/** Сколько ИИ-правок даёт один оплаченный пакет */
export const EDITS_PER_PACKAGE = envInt('TOKEN_EDITS_PER_PACKAGE', 10)

/** Стартовый бонус при регистрации, в токенах */
export const WELCOME_BONUS_TOKENS = envInt('WELCOME_BONUS_TOKENS', 500)

/**
 * Лимит ИИ-правок документа.
 * packages — число НЕотменённых списаний, дающих пакет
 * (GENERATE | UPLOAD_EDIT_START | REWRITE | EDIT_PACKAGE).
 * hasAnyPackageCharge — было ли ХОТЬ ОДНО такое списание за всю историю
 * документа (включая возвращённые). Неявный бесплатный пакет даётся только
 * до-токеновым документам — тем, у кого списаний не было вовсе. Так возврат
 * упавшей генерации (packages снова 0, но история есть) не открывает бесплатный
 * пакет. Загруженные документы неявного пакета не получают.
 */
export function calcEditLimit(packages: number, isUploaded: boolean, hasAnyPackageCharge: boolean): number {
  const implicit = !isUploaded && !hasAnyPackageCharge ? 1 : 0
  return (packages + implicit) * EDITS_PER_PACKAGE
}

/** «5 токенов» / «21 токен» / «2 токена» */
export function formatTokens(n: number): string {
  const abs = Math.abs(n) % 100
  const d = abs % 10
  const word = abs >= 11 && abs <= 14 ? 'токенов' : d === 1 ? 'токен' : d >= 2 && d <= 4 ? 'токена' : 'токенов'
  return `${n} ${word}`
}
