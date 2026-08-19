// Чистые данные о моделях и подсказки «какая модель для какой задачи».
// НЕ импортирует gigachat-fetch/undici — безопасно тянуть в клиентский бандл
// (страница /admin/ai). Серверные функции (auth/verify/list) — в gigachat-models.ts.

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
