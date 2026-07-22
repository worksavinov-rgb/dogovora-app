/** Все типы задач ИИ. `default` — запасной маршрут, если конкретная задача не настроена. */
export const AI_TASKS = [
  'default',
  'generate',
  'edit',
  'chat',
  'quick_analysis',
  'review',
  'analyze_upload',
  'spelling',
  'review_fallback',
  'extract_parties',
] as const

export type AITask = (typeof AI_TASKS)[number]

export interface AITaskDefinition {
  task: AITask
  label: string
  description: string
  /** Где в UI вызывается */
  uiWhere: string
  /** Задачи, для которых показываем в основной таблице конфигуратора */
  primary: boolean
}

export const AI_TASK_DEFINITIONS: AITaskDefinition[] = [
  {
    task: 'default',
    label: 'По умолчанию',
    description: 'Запасной маршрут, если у задачи нет своей настройки',
    uiWhere: 'Любая незаданная задача',
    primary: true,
  },
  {
    task: 'generate',
    label: 'Генерация документа',
    description: 'Создание первого черновика договора',
    uiWhere: 'Новый документ → создание / кнопка «Сгенерировать»',
    primary: true,
  },
  {
    task: 'edit',
    label: 'Редактирование',
    description: 'Правка текста по инструкции в чате',
    uiWhere: 'Рабочий экран → режим «Правка» + быстрые чипы правок',
    primary: true,
  },
  {
    task: 'chat',
    label: 'Чат (вопросы)',
    description: 'Ответы на вопросы без изменения документа',
    uiWhere: 'Рабочий экран → режим «Вопрос» + быстрые чипы вопросов',
    primary: true,
  },
  {
    task: 'quick_analysis',
    label: 'Быстрый анализ в чате',
    description: 'Краткий разбор слабых мест договора в чате (без JSON-отчёта)',
    uiWhere: 'Рабочий экран → кнопка «Анализ» в шапке чата',
    primary: true,
  },
  {
    task: 'review',
    label: 'Проверка рисков',
    description: 'Полный юридический анализ со score и списком замечаний',
    uiWhere: 'Рабочий экран → «Риски» → экран проверки документа',
    primary: true,
  },
  {
    task: 'analyze_upload',
    label: 'Анализ при загрузке',
    description: 'Проверка загруженного файла (тот же тип отчёта, что «Риски»)',
    uiWhere: 'Загрузить документ → «Анализировать документ»',
    primary: true,
  },
  {
    task: 'extract_parties',
    label: 'Извлечение реквизитов',
    description: 'Парсинг сторон из текста (ИНН, названия) — с согласием на ПДн',
    uiWhere: 'Загрузить документ → галочка согласия на извлечение реквизитов',
    primary: true,
  },
  {
    task: 'spelling',
    label: 'Орфография',
    description: 'Вспомогательный подсчёт орфографии внутри проверки',
    uiWhere: 'Внутри «Риски» / «Анализ при загрузке»',
    primary: false,
  },
  {
    task: 'review_fallback',
    label: 'Проверка (запасной)',
    description: 'Повтор при отказе фильтра безопасности',
    uiWhere: 'Автоматически внутри проверки, если основной запрос отклонён',
    primary: false,
  },
]

export const OPERATOR_SLUGS = ['polza', 'gigachat', 'mock'] as const
export type OperatorSlug = (typeof OPERATOR_SLUGS)[number]

export const GIGACHAT_MODELS = [
  'GigaChat-2',
  'GigaChat-2-Pro',
  'GigaChat-2-Max',
] as const
