// Константы и чистые помощники корпуса норм права.

/** Размерность вектора эмбеддинга. Должна совпадать с моделью оператора и колонкой vector(N). */
export const LEGAL_EMBEDDING_DIM = 1536

/** «ст. 454 п. 1» либо «ст. 454», если пункта нет. */
export function buildNormPath(articleNumber: string, paragraphNumber?: string | null): string {
  const base = `ст. ${articleNumber}`
  return paragraphNumber ? `${base} п. ${paragraphNumber}` : base
}

/** Вход для to_tsvector: заголовок + текст, через один пробел, без ведущих пробелов. */
export function buildFtsInput(title: string, text: string): string {
  return [title, text].filter((s) => s && s.trim().length > 0).join(' ')
}
