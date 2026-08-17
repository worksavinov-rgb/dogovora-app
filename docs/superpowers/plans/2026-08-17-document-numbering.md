# Нумерация договоров по юрлицам — план реализации

> **Для агентов-исполнителей:** используйте superpowers:subagent-driven-development или superpowers:executing-plans, задача за задачей. Шаги помечены чекбоксами `- [ ]`.

**Цель:** у каждого собственного юрлица пользователя (`Profile`) свой формат номера договора; при создании и загрузке документа система предлагает следующий номер по этому формату; поиск находит документ по номеру.

**Архитектура:** формат хранится в одной новой колонке `Profile.contractNumberFormat` как шаблон с плейсхолдерами (`{NNN}/{ММ}-{ГГ}`). Счётчик нигде не хранится — следующий номер вычисляется обратным разбором номеров уже существующих документов этого юрлица: шаблон превращается в regex с зафиксированной датой и capture-группой под счётчик, берётся `max + 1`. Вся строковая логика вынесена в чистый модуль без Prisma и React.

**Стек:** Next.js 16 (App Router), TypeScript strict, Prisma 5, zod 4, Tailwind.

## Глобальные ограничения

- Интерфейс только на русском языке (правило 7 в `CLAUDE.md`).
- Все запросы к документам и профилям скоупятся по владельцу: `where: { … userId }` (правило 9). Ни один новый роут не должен это обходить.
- Содержимое договоров в логи не попадает (правило 11). Номер документа — это метаданные, его логировать можно; текст версий — нет.
- Версии append-only (правило 1) — этот план версий не касается.
- Динамические роуты Next.js 16: сигнатура `{ params }: { params: Promise<{ id: string }> }`, `params` обязательно `await`.
- Авторизация в новых роутах — `getUserId` из `@/lib/api-auth` (он проверяет отзыв токена), а не локальные копии `getCurrentUserId`.
- Коммиты на русском языке.
- **Тестового раннера в проекте нет и заводить его решено не было.** Поэтому вместо TDD-цикла каждая задача заканчивается шагом `pnpm typecheck` и ручной проверкой в браузере с конкретным ожидаемым результатом.

---

### Задача 1: Ядро нумерации — чистый модуль

**Файлы:**
- Создать: `apps/web/src/lib/document-number.ts`

**Интерфейсы:**
- Потребляет: ничего.
- Отдаёт: `normalizeFormat`, `validateFormat`, `formatScope`, `renderNumber`, `buildMatcher`, `nextNumber`, `periodFromDateString`, типы `NumberScope`, `FormatError`, `FormatErrorCode`. На них опираются задачи 2, 3, 4, 5.

- [ ] **Шаг 1: Создать модуль целиком**

```ts
// apps/web/src/lib/document-number.ts
//
// Нумерация договоров по юрлицам.
//
// Формат номера задаётся пользователем в карточке своего юрлица как шаблон
// с плейсхолдерами, например "{NNN}/{ММ}-{ГГ}" → "005/08-26".
//
// Счётчик нигде не хранится. Следующий номер вычисляется обратным разбором
// уже существующих номеров: шаблон превращается в regex, где плейсхолдеры даты
// зафиксированы текущим периодом, а счётчик — capture-группа. Из совпавших
// номеров берётся максимум и увеличивается на единицу.
//
// Такой подход самовосстанавливается: пользователь может вписать номер руками,
// отменить создание документа или поменять шаблон — система всё равно продолжит
// с фактического максимума, потому что состояние = сами документы.
//
// Модуль чистый: без Prisma, без React, без сети. Только строки и даты.

/** Область, внутри которой счётчик начинается заново. Выводится из шаблона. */
export type NumberScope = 'month' | 'year' | 'global'

export type FormatErrorCode = 'EMPTY' | 'NO_COUNTER' | 'MANY_COUNTERS' | 'UNKNOWN_TOKEN'

export interface FormatError {
  code: FormatErrorCode
  message: string
  /** Плейсхолдер, из-за которого ошибка (для UNKNOWN_TOKEN). */
  token?: string
}

type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'counter'; width: number }
  | { kind: 'year4' }
  | { kind: 'year2' }
  | { kind: 'month' }

/** Плейсхолдеры в каноническом (кириллическом) виде — для подсказки в UI. */
export const PLACEHOLDER_HINTS: Array<{ token: string; label: string; example: string }> = [
  { token: '{N}', label: 'счётчик без ведущих нулей', example: '5' },
  { token: '{NN}', label: 'счётчик, 2 знака', example: '05' },
  { token: '{NNN}', label: 'счётчик, 3 знака', example: '005' },
  { token: '{ГГГГ}', label: 'год полностью', example: '2026' },
  { token: '{ГГ}', label: 'год, 2 цифры', example: '26' },
  { token: '{ММ}', label: 'месяц, 2 цифры', example: '08' },
]

/**
 * Приводит шаблон к каноническому виду: латинские алиасы → кириллица,
 * регистр плейсхолдеров → верхний.
 *
 * Кириллическая «М» и латинская «M» неразличимы на глаз, поэтому принимать
 * только один вариант — значит гарантированно ловить жалобы «формат не
 * сохраняется». Всё, что вне фигурных скобок, не трогаем.
 */
export function normalizeFormat(tpl: string): string {
  return tpl.replace(/\{([^}]*)\}/g, (whole, inner: string) => {
    const up = inner.toUpperCase()
    if (/^[NН]+$/.test(up)) return `{${'N'.repeat(up.length)}}`
    if (up === 'YYYY' || up === 'ГГГГ') return '{ГГГГ}'
    if (up === 'YY' || up === 'ГГ') return '{ГГ}'
    if (up === 'MM' || up === 'ММ') return '{ММ}'
    return whole
  })
}

function tokenize(tpl: string): { tokens: Token[]; unknown: string[] } {
  const tokens: Token[] = []
  const unknown: string[] = []
  const re = /\{[^}]*\}/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) tokens.push({ kind: 'literal', text: tpl.slice(last, m.index) })
    const t = m[0]
    if (/^\{N+\}$/.test(t)) tokens.push({ kind: 'counter', width: t.length - 2 })
    else if (t === '{ГГГГ}') tokens.push({ kind: 'year4' })
    else if (t === '{ГГ}') tokens.push({ kind: 'year2' })
    else if (t === '{ММ}') tokens.push({ kind: 'month' })
    else {
      unknown.push(t)
      tokens.push({ kind: 'literal', text: t })
    }
    last = m.index + t.length
  }
  if (last < tpl.length) tokens.push({ kind: 'literal', text: tpl.slice(last) })

  return { tokens, unknown }
}

/**
 * Проверяет шаблон. Возвращает null, если он корректен.
 *
 * Неизвестный плейсхолдер — именно ошибка, а не «оставим как есть»: иначе
 * пользователь получит договор с номером «{ГОД}/08» и заметит это уже в Word.
 */
export function validateFormat(tpl: string): FormatError | null {
  const normalized = normalizeFormat(tpl).trim()
  if (!normalized) {
    return { code: 'EMPTY', message: 'Шаблон пустой' }
  }

  const { tokens, unknown } = tokenize(normalized)
  if (unknown.length > 0) {
    return {
      code: 'UNKNOWN_TOKEN',
      message: `Неизвестный плейсхолдер ${unknown[0]}. Доступны: {N}, {NN}, {NNN}, {ГГГГ}, {ГГ}, {ММ}`,
      token: unknown[0],
    }
  }

  const counters = tokens.filter((t) => t.kind === 'counter').length
  if (counters === 0) {
    return { code: 'NO_COUNTER', message: 'В шаблоне нет счётчика — добавьте {N}, {NN} или {NNN}' }
  }
  if (counters > 1) {
    return { code: 'MANY_COUNTERS', message: 'В шаблоне больше одного счётчика — оставьте только один' }
  }

  return null
}

/**
 * Область сброса счётчика выводится из самого шаблона.
 *
 * Отдельной настройки «сброс» намеренно нет: комбинация «шаблон без года +
 * ежегодный сброс» породила бы одинаковые номера в разные годы.
 */
export function formatScope(tpl: string): NumberScope {
  const { tokens } = tokenize(normalizeFormat(tpl))
  if (tokens.some((t) => t.kind === 'month')) return 'month'
  if (tokens.some((t) => t.kind === 'year2' || t.kind === 'year4')) return 'year'
  return 'global'
}

export const SCOPE_LABELS: Record<NumberScope, string> = {
  month: 'счёт начинается заново каждый месяц',
  year: 'счёт начинается заново каждый год',
  global: 'сквозная нумерация без сброса',
}

function yearOf(date: Date): string {
  return String(date.getFullYear())
}

function monthOf(date: Date): string {
  return String(date.getMonth() + 1).padStart(2, '0')
}

/** Подставляет в шаблон конкретный порядковый номер и период. */
export function renderNumber(tpl: string, seq: number, date: Date): string {
  const { tokens } = tokenize(normalizeFormat(tpl))
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'literal':
          return t.text
        case 'counter':
          return String(seq).padStart(t.width, '0')
        case 'year4':
          return yearOf(date)
        case 'year2':
          return yearOf(date).slice(-2)
        case 'month':
          return monthOf(date)
      }
    })
    .join('')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Строит regex, который узнаёт номера этого шаблона за конкретный период.
 * Дата зафиксирована, счётчик — capture-группа 1.
 *
 * Флаг `g` не ставим намеренно: RegExp с `g` хранит lastIndex между вызовами
 * exec, и переиспользование такого объекта в цикле давало бы пропуски.
 */
export function buildMatcher(tpl: string, date: Date): RegExp {
  const { tokens } = tokenize(normalizeFormat(tpl))
  const body = tokens
    .map((t) => {
      switch (t.kind) {
        case 'literal':
          return escapeRegExp(t.text)
        case 'counter':
          return '(\\d+)'
        case 'year4':
          return escapeRegExp(yearOf(date))
        case 'year2':
          return escapeRegExp(yearOf(date).slice(-2))
        case 'month':
          return escapeRegExp(monthOf(date))
      }
    })
    .join('')
  return new RegExp(`^${body}$`)
}

/**
 * Следующий свободный номер: максимум среди подходящих существующих + 1.
 *
 * Номера, не подходящие под шаблон текущего периода, игнорируются — это и есть
 * механизм сброса: в сентябре номера с «/08-» просто перестают совпадать.
 */
export function nextNumber(
  tpl: string,
  existing: Array<string | null | undefined>,
  date: Date,
): string {
  const re = buildMatcher(tpl, date)
  let max = 0
  for (const raw of existing) {
    if (!raw) continue
    const m = re.exec(raw.trim())
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = n
  }
  return renderNumber(tpl, max + 1, date)
}

/**
 * Разбирает дату вида "2026-08-17" в локальную Date без сдвига часового пояса.
 *
 * new Date("2026-08-01") трактуется как UTC-полночь, и в отрицательных
 * смещениях это даёт 31 июля — то есть номер за прошлый месяц. Поэтому парсим
 * строку сами.
 */
export function periodFromDateString(value?: string | null): Date {
  if (value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  return new Date()
}
```

- [ ] **Шаг 2: Проверить типы**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора" && pnpm typecheck
```

Ожидается: без ошибок.

- [ ] **Шаг 3: Прогнать логику вручную одним скриптом**

Тестового раннера нет, поэтому разовая проверка через `tsx`:

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора/apps/web" && cat > /tmp/check-numbering.ts <<'EOF'
import { nextNumber, renderNumber, validateFormat, formatScope, normalizeFormat } from './src/lib/document-number'
const aug = new Date(2026, 7, 17)
const sep = new Date(2026, 8, 1)
console.log(renderNumber('{NNN}/{ММ}-{ГГ}', 5, aug))              // 005/08-26
console.log(nextNumber('{NNN}/{ММ}-{ГГ}', [], aug))               // 001/08-26
console.log(nextNumber('{NNN}/{ММ}-{ГГ}', ['010/08-26'], aug))    // 011/08-26
console.log(nextNumber('{NNN}/{ММ}-{ГГ}', ['010/08-26'], sep))    // 001/09-26
console.log(nextNumber('ДГ-{NN}/{ГГГГ}', ['ДГ-07/2026'], aug))    // ДГ-08/2026
console.log(normalizeFormat('{nnn}/{MM}-{YY}'))                   // {NNN}/{ММ}-{ГГ}
console.log(formatScope('{NNN}'), formatScope('{NNN}/{ГГ}'), formatScope('{NNN}/{ММ}'))  // global year month
console.log(validateFormat('{ГГ}'), validateFormat('{NN}/{N}'), validateFormat('{ГОД}'))
EOF
npx tsx /tmp/check-numbering.ts```

Ожидаемый вывод — ровно строки, указанные в комментариях; `validateFormat` даёт
`NO_COUNTER`, `MANY_COUNTERS`, `UNKNOWN_TOKEN` соответственно.

- [ ] **Шаг 4: Удалить временный скрипт и закоммитить**

```bash
rm -f /tmp/check-numbering.ts
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора"
git add apps/web/src/lib/document-number.ts docs/superpowers/plans/2026-08-17-document-numbering.md
git commit -m "Ядро нумерации договоров: шаблоны номеров и расчёт следующего"
```

---

### Задача 2: Колонка формата в Profile и приём её в API профилей

**Файлы:**
- Изменить: `apps/web/prisma/schema.prisma` (модель `Profile`, ~строка 79; модель `Document`, ~строка 201)
- Создать: `apps/web/prisma/migrations/<timestamp>_add_profile_contract_number_format/migration.sql` (генерируется Prisma)
- Изменить: `apps/web/src/app/api/profiles/route.ts:8-22` (`profileSchema`)
- Изменить: `apps/web/src/app/api/profiles/[id]/route.ts:6-20` (`profileUpdateSchema`)

**Интерфейсы:**
- Потребляет: `validateFormat`, `normalizeFormat` из задачи 1.
- Отдаёт: поле `contractNumberFormat` в ответах `GET /api/profiles` и `GET /api/profiles/:id`; принимается в `POST`/`PUT`.

- [ ] **Шаг 1: Добавить колонку и индекс в схему**

В `model Profile` после `stampFilePath`:

```prisma
  // Шаблон номера договора для этого юрлица, например "{NNN}/{ММ}-{ГГ}".
  // null или пустая строка — нумерация не настроена, номер вводится свободно.
  contractNumberFormat String?
```

В `model Document` перед `@@map("documents")`:

```prisma
  @@index([userId, profileId, number])
```

Индекс нужен обеим горячим операциям: расчёту следующего номера (выборка номеров
одного юрлица) и проверке дубля.

- [ ] **Шаг 2: Создать миграцию**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора" && pnpm db:migrate:dev --name add_profile_contract_number_format
```

Ожидается: создана папка миграции, `prisma generate` отработал.

- [ ] **Шаг 3: Принять поле в схемах валидации**

В `apps/web/src/app/api/profiles/route.ts` импортировать ядро и добавить поле в `profileSchema`:

```ts
import { normalizeFormat, validateFormat } from '@/lib/document-number'
```

```ts
  contractNumberFormat: z
    .string()
    .trim()
    .transform((v) => (v ? normalizeFormat(v) : ''))
    .refine((v) => v === '' || validateFormat(v) === null, {
      message: 'Некорректный шаблон номера договора',
    })
    .transform((v) => (v === '' ? null : v))
    .optional(),
```

Пустая строка осознанно превращается в `null`: «очистить поле» и «не настроено» —
одно и то же состояние, два разных представления породили бы разное поведение UI.

То же самое добавить в `profileUpdateSchema` в `apps/web/src/app/api/profiles/[id]/route.ts`,
дополнительно разрешив `.nullable()` — там остальные скалярные поля тоже nullable.

- [ ] **Шаг 4: Проверить типы и закоммитить**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора" && pnpm typecheck
git add apps/web/prisma apps/web/src/app/api/profiles
git commit -m "Формат номера договора в профиле юрлица: колонка, миграция, валидация"
```

---

### Задача 3: API нумерации и поиск по номеру

**Файлы:**
- Создать: `apps/web/src/app/api/profiles/[id]/next-number/route.ts`
- Создать: `apps/web/src/app/api/documents/number-check/route.ts`
- Изменить: `apps/web/src/app/api/documents/route.ts:52-69` (GET: поиск по номеру, фильтр `parentDocumentId`)

**Интерфейсы:**
- Потребляет: `nextNumber`, `renderNumber`, `formatScope`, `periodFromDateString`, `SCOPE_LABELS` из задачи 1.
- Отдаёт:
  - `GET /api/profiles/:id/next-number?date=YYYY-MM-DD` → `{ format: string | null, next: string | null, scope: NumberScope | null, scopeLabel: string | null, sample: string | null }`
  - `GET /api/documents/number-check?profileId=&number=&excludeId=` → `{ conflict: { id: string, title: string, counterpartyName: string } | null }`

- [ ] **Шаг 1: Роут следующего номера**

```ts
// apps/web/src/app/api/profiles/[id]/next-number/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import {
  formatScope,
  nextNumber,
  periodFromDateString,
  renderNumber,
  SCOPE_LABELS,
} from '@/lib/document-number'

// GET /api/profiles/:id/next-number?date=YYYY-MM-DD
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const profile = await prisma.profile.findFirst({
    where: { id, userId },
    select: { contractNumberFormat: true },
  })
  if (!profile) return NextResponse.json({ error: 'Профиль не найден' }, { status: 404 })

  const tpl = profile.contractNumberFormat?.trim()
  if (!tpl) {
    return NextResponse.json({ format: null, next: null, scope: null, scopeLabel: null, sample: null })
  }

  const { searchParams } = new URL(req.url)
  const date = periodFromDateString(searchParams.get('date'))

  // Приложения и допсоглашения наследуют номер родителя и собственный счётчик
  // не тратят, поэтому в выборку идут только договоры.
  const docs = await prisma.document.findMany({
    where: { userId, profileId: id, type: 'CONTRACT', number: { not: null } },
    select: { number: true },
  })

  const scope = formatScope(tpl)
  return NextResponse.json({
    format: tpl,
    next: nextNumber(tpl, docs.map((d) => d.number), date),
    scope,
    scopeLabel: SCOPE_LABELS[scope],
    sample: renderNumber(tpl, 1, date),
  })
}
```

- [ ] **Шаг 2: Роут проверки дубля**

```ts
// apps/web/src/app/api/documents/number-check/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

// GET /api/documents/number-check?profileId=&number=&excludeId=
//
// Дубли номеров не запрещены — у пользователей встречаются одинаковые номера
// в старых бумагах. Роут нужен, чтобы показать предупреждение со ссылкой.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const number = (searchParams.get('number') ?? '').trim()
  const profileId = searchParams.get('profileId')
  const excludeId = searchParams.get('excludeId')

  if (!number || !profileId) return NextResponse.json({ conflict: null })

  const doc = await prisma.document.findFirst({
    where: {
      userId,
      profileId,
      number,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, title: true, counterparty: { select: { name: true } } },
  })

  return NextResponse.json({
    conflict: doc
      ? { id: doc.id, title: doc.title, counterpartyName: doc.counterparty?.name ?? '' }
      : null,
  })
}
```

- [ ] **Шаг 3: Поиск по номеру и фильтр по родителю**

В `apps/web/src/app/api/documents/route.ts` в GET после строки с `counterpartyId` добавить чтение параметра:

```ts
  const parentDocumentId = searchParams.get('parentDocumentId')
```

Заменить условие поиска (строка 63):

```ts
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { number: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
```

и добавить рядом с фильтром по типу:

```ts
      ...(parentDocumentId ? { parentDocumentId } : {}),
```

Фильтр `parentDocumentId` мастер уже запрашивает (`documents/new/page.tsx:925`),
но роут его игнорировал — из-за этого предлагаемый номер приложения считался по
всем документам пользователя.

- [ ] **Шаг 4: Проверить в браузере**

Запустить превью и выполнить:

```
GET /api/documents?q=<кусок номера существующего договора>
```

Ожидается: договор в выдаче (до правки — пустой массив).

- [ ] **Шаг 5: Закоммитить**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора"
git add apps/web/src/app/api
git commit -m "API нумерации: следующий номер, проверка дубля, поиск по номеру"
```

---

### Задача 4: Блок «Нумерация договоров» в карточке юрлица

**Файлы:**
- Изменить: `apps/web/src/app/(app)/requisites/page.tsx` — тип формы (~строка 159, компонент `ProfileForm`), разметка после блока «Основное» (~строка 306), сборка payload в `handleSave` (~строка 472)

**Интерфейсы:**
- Потребляет: `validateFormat`, `formatScope`, `renderNumber`, `SCOPE_LABELS`, `PLACEHOLDER_HINTS` из задачи 1; `GET /api/profiles/:id/next-number` из задачи 3.
- Отдаёт: пользователь может задать и увидеть формат.

- [ ] **Шаг 1: Добавить поле в состояние формы**

В тип данных профиля и в начальное состояние добавить `contractNumberFormat: string` со значением `''`. В `handleSave` отправлять его как есть — нормализацию и валидацию делает сервер (задача 2), но UI показывает ошибку сразу.

- [ ] **Шаг 2: Разметка блока**

Новая секция после «Основное», в стиле остальных секций страницы:

- заголовок «Нумерация договоров»;
- `Input` с `placeholder="{NNN}/{ММ}-{ГГ}"`;
- под ним, если поле непустое и `validateFormat` вернул `null`: строка
  `Пример: 001/08-26 · счёт начинается заново каждый месяц` (используя
  `renderNumber(tpl, 1, new Date())` и `SCOPE_LABELS[formatScope(tpl)]`);
- если `validateFormat` вернул ошибку — её `message` красным, тем же приёмом,
  каким на странице показываются ошибки ИНН;
- список `PLACEHOLDER_HINTS` мелким шрифтом: `{NNN} — счётчик, 3 знака (005)`;
- если профиль уже сохранён (`!isNew && profileId`) — строка «Следующий номер: …»,
  подгружаемая из `GET /api/profiles/:id/next-number`;
- пояснение: «Оставьте пустым, если не нужна автоматическая нумерация».

- [ ] **Шаг 3: Проверить в браузере**

1. Открыть `/requisites`, выбрать юрлицо, вписать `{NNN}/{ММ}-{ГГ}` → под полем
   «Пример: 001/08-26 · счёт начинается заново каждый месяц».
2. Вписать `{ГОД}` → красная ошибка про неизвестный плейсхолдер, сохранение
   отклоняется сервером с тем же текстом.
3. Вписать `{nnn}/{MM}-{YY}` латиницей, сохранить, перезагрузить → в поле
   `{NNN}/{ММ}-{ГГ}` (сервер нормализовал).
4. Очистить поле, сохранить → в БД `null`, блок «Следующий номер» скрыт.

- [ ] **Шаг 4: Закоммитить**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора"
git add "apps/web/src/app/(app)/requisites/page.tsx"
git commit -m "Карточка юрлица: блок настройки формата номера договора"
```

---

### Задача 5: Общий компонент выбора номера

**Файлы:**
- Создать: `apps/web/src/components/document-number-field.tsx`

**Интерфейсы:**
- Потребляет: `GET /api/profiles/:id/next-number`, `GET /api/documents/number-check` из задачи 3.
- Отдаёт: компонент `DocumentNumberField` со следующими props — на них опираются задачи 6, 7, 8:

```ts
interface DocumentNumberFieldProps {
  profileId: string | null | undefined
  /** Дата подписания в формате YYYY-MM-DD; от неё зависит период счётчика. */
  signingDate?: string | null
  value: string
  onChange: (value: string) => void
  /** Исключить документ из проверки дубля — при редактировании самого себя. */
  excludeDocumentId?: string
  label?: string
  disabled?: boolean
}
```

- [ ] **Шаг 1: Реализовать компонент**

Поведение:

1. При изменении `profileId` или `signingDate` — запрос `next-number`.
2. Если `format === null` (нумерация не настроена) или `profileId` пуст —
   рендерить обычный текстовый `Input`, никаких радиокнопок. Компонент должен
   быть безопасной заменой текущему полю везде.
3. Иначе — две радиокнопки:
   - «Следующий по порядку — `{next}`» (выбрана, если `value === next` или `value` пуст);
   - «Свой номер» + `Input`.
   Выбор первой сразу вызывает `onChange(next)`.
4. Проверка дубля — `number-check` с задержкой 400 мс после последнего ввода,
   чтобы не бить в API на каждую букву (в списке документов такой дебаунс
   отсутствует и это заметно).
5. При найденном конфликте — жёлтая плашка: «Номер `{value}` уже у документа
   «`{title}`» (`{counterpartyName}`)» со ссылкой на `/documents/{id}`.
   Сохранение при этом не блокируется.
6. Все сетевые запросы — с `credentials: 'include'`, как в остальных фетчах проекта.
7. Гонка ответов: хранить номер последнего запроса и игнорировать пришедшие
   не последними — иначе быстрая смена юрлица подставит номер от предыдущего.

- [ ] **Шаг 2: Проверить типы**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора" && pnpm typecheck
```

- [ ] **Шаг 3: Закоммитить**

```bash
git add apps/web/src/components/document-number-field.tsx
git commit -m "Компонент выбора номера документа: следующий по порядку или свой"
```

---

### Задача 6: Мастер создания документа

**Файлы:**
- Изменить: `apps/web/src/app/(app)/documents/new/page.tsx` — поле номера (~строка 1039), автоподстановка при выборе родителя (~строки 923-931), payload (~строка 1465)

**Интерфейсы:**
- Потребляет: `DocumentNumberField` из задачи 5.

- [ ] **Шаг 1: Заменить поле номера**

Для `type === 'CONTRACT'` вместо текущего `Input` — `DocumentNumberField` с
`profileId={data.profileId}`, `signingDate={data.signingDate}`,
`value={data.number}`, `onChange={(number) => onChange({ ...data, number })}`.

Для `APPENDIX` и `AMENDMENT` поле номера **убрать полностью** — они наследуют
номер родителя, а порядковый номер присваивает сервер.

- [ ] **Шаг 2: Починить автоподстановку номера приложения**

Удалить блок на строках ~923-931, который при выборе родительского договора
писал `maxNum + 1` в текстовое поле `number`. Порядковый номер вычисляет сервер
(`api/documents/route.ts:136-145`), а `Document.number` дочернего документа
должен оставаться пустым — иначе у приложения оказывается два конфликтующих
номера (`number = "3"` и `documentNumber = 1`).

- [ ] **Шаг 3: Проверить в браузере**

1. `/documents/new`, тип «Договор», юрлицо с форматом → предложен следующий номер.
2. Сменить юрлицо на второе (с другим форматом) → номер пересчитался под его формат.
3. Задать дату подписания в следующем месяце → счётчик начался заново.
4. Выбрать «Свой номер», вписать занятый → жёлтая плашка, сохранение проходит.
5. Тип «Приложение», выбрать родителя → поля номера нет; после создания в
   карточке видно «Приложение № 1 к Договору № …», а `Document.number` пуст.

- [ ] **Шаг 4: Закоммитить**

```bash
git add "apps/web/src/app/(app)/documents/new/page.tsx"
git commit -m "Мастер создания: подсказка следующего номера, приложения больше не затирают номер"
```

---

### Задача 7: Экран загрузки Word-документа

**Файлы:**
- Изменить: `apps/web/src/app/(app)/documents/upload/page.tsx` — шаг `result` (~строки 727-859), `createAndOpen` (~строки 576-617)

**Интерфейсы:**
- Потребляет: `DocumentNumberField` из задачи 5.

- [ ] **Шаг 1: Начать передавать profileId**

Сейчас `POST /api/documents` из этого экрана не передаёт `profileId` вообще
(строки 586-600), поэтому загруженные документы не привязаны к юрлицу и
нумеровать их нечем. Экран уже определяет «моё» юрлицо (`saveMyProfile`,
строки 535-574) — результат этого выбора нужно передать как `profileId`.

- [ ] **Шаг 2: Добавить выбор номера**

На шаге `result`, рядом с названием документа, — `DocumentNumberField` с
`profileId` определённого юрлица. Из текста файла номер не извлекаем: у
пользователя есть «следующий по порядку» и «свой номер».

- [ ] **Шаг 3: Проверить в браузере**

1. Загрузить `.docx` от юрлица с настроенным форматом → предложен следующий номер.
2. Выбрать «Свой номер», вписать номер из старой бумаги → сохранился как есть.
3. Открыть карточку документа → юрлицо и номер на месте.
4. Создать после этого новый договор от того же юрлица → счётчик учёл загруженный.

- [ ] **Шаг 4: Закоммитить**

```bash
git add "apps/web/src/app/(app)/documents/upload/page.tsx"
git commit -m "Загрузка документа: привязка к юрлицу и присвоение номера"
```

---

### Задача 8: Список документов и модалки редактирования

**Файлы:**
- Изменить: `apps/web/src/app/(app)/documents/page.tsx` — плейсхолдер поиска (~строка 912), `SortField` (~строка 29) и `sortDocs` (~строка 65), `EditDocumentModal` (~строка 158), `SignDocumentModal` (~строка 255)
- Изменить: `apps/web/src/app/(app)/documents/[id]/page.tsx` — `SignModal` (~строка 79)

**Интерфейсы:**
- Потребляет: `DocumentNumberField` из задачи 5; серверный поиск по номеру из задачи 3.

- [ ] **Шаг 1: Поиск и сортировка**

Плейсхолдер поиска → «Поиск по названию или номеру». Серверная часть уже готова
(задача 3). В `SortField` добавить `'number'`, в `sortDocs` — сравнение
`localeCompare` с `numeric: true`, чтобы `10/08-26` шёл после `9/08-26`, а не
перед ним. Колонку `№` сделать кликабельной через существующий `SortableHeader`.

- [ ] **Шаг 2: Заменить голые инпуты номера**

В `EditDocumentModal` и обеих модалках подписания — `DocumentNumberField` с
`profileId` документа и `excludeDocumentId` равным его `id` (иначе документ
найдёт сам себя как дубль).

- [ ] **Шаг 3: Проверить в браузере**

1. В поиске списка вписать номер → найден ровно нужный договор.
2. Кликнуть по заголовку колонки `№` → сортировка по номеру, `10/…` после `9/…`.
3. Открыть «Параметры документа» → предупреждения о дубле самого себя нет.

- [ ] **Шаг 4: Закоммитить**

```bash
git add "apps/web/src/app/(app)/documents/page.tsx" "apps/web/src/app/(app)/documents/[id]/page.tsx"
git commit -m "Список документов: поиск и сортировка по номеру, единое поле номера в модалках"
```

---

### Задача 9: Сквозная проверка и отметка в CLAUDE.md

- [ ] **Шаг 1: Пройти сценарий из спецификации**

Все 13 шагов раздела «Сценарий ручной проверки» в
`docs/superpowers/specs/2026-08-17-document-numbering-design.md`.

- [ ] **Шаг 2: Линт и типы**

```bash
cd "/Users/pavelsavinov/Music/САЙТЫ/Договора" && pnpm typecheck && pnpm lint
```

- [ ] **Шаг 3: Добавить фазу 16 в CLAUDE.md**

Раздел ЗАДАЧИ, новая таблица «Фаза 16 — Нумерация договоров по юрлицам» с
задачами 16.1–16.6 по числу реализованных кусков, все ✅. Обновить дату в
подписи внизу файла.

- [ ] **Шаг 4: Закоммитить**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: фаза 16 — нумерация договоров по юрлицам"
```

---

## Что в объём не входит

- Номер в шапке договора (`buildContractPreambleHtml` его не принимает) — отдельная задача.
- Тесты и тестовый раннер — решено не заводить.
- Извлечение номера из текста загруженного файла.
- Жёсткая уникальность номеров.
- Отдельные шаблоны для приложений и допсоглашений.
