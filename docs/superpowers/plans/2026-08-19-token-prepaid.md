# Предоплата токенами — план внедрения

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Спека:** `docs/superpowers/specs/2026-08-19-token-prepaid-design.md` — прочитать перед началом.

**Goal:** Перевести Догодок с постоплаты за версию на предоплату токенами, открыть предпросмотр (без водяных знаков, с редактированием), вынести шапку/реквизиты в отдельный слой со шагом «Оформление».

**Architecture:** Три фазы, каждая — рабочий продукт. Фаза A: токеновая экономика + демонтаж постоплаты (единый конфиг цен, append-only `TokenCharge`, списания по `SELECT FOR UPDATE`-паттерну из purchase). Фаза B: редактируемый TipTap-предпросмотр + настоящий серверный черновик. Фаза C: шапка/реквизиты как слой документа, воркер генерирует только тело.

**Tech Stack:** Next.js 14 App Router, Prisma/PostgreSQL, BullMQ, TipTap 3, vitest.

## Global Constraints

- Интерфейс только на русском. Коммиты на русском.
- Версии append-only: текст существующей версии никогда не UPDATE-ится.
- Содержимое договоров не попадает в логи (только размеры/счётчики/коды).
- Скоуп владельца везде: `where: { …, document: { userId } }` / `{ …, userId }`.
- Одна primary-кнопка на экран.
- Топап остаётся закрытым (503) — не открывать.
- Команды запускать из `apps/web/`: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm exec prisma migrate dev`.
- После каждой задачи: `pnpm typecheck` зелёный, коммит.

---

# Фаза A — токеновая экономика и демонтаж постоплаты

### Task A1: Конфиг цен `token-pricing.ts`

**Files:**
- Create: `apps/web/src/lib/token-pricing.ts`
- Test: `apps/web/tests/token-pricing.test.ts`

**Interfaces:**
- Produces: `TOKEN_PRICES: { generate, uploadEditStart, rewrite, editPackage, review, analyzeUpload }` (числа), `EDITS_PER_PACKAGE: number`, `WELCOME_BONUS_TOKENS: number`, `calcEditLimit(packages: number, isUploaded: boolean): number`, `formatTokens(n: number): string`.

- [ ] **Step 1: Написать падающий тест**

```ts
// apps/web/tests/token-pricing.test.ts
import { describe, it, expect } from 'vitest'
import { TOKEN_PRICES, EDITS_PER_PACKAGE, WELCOME_BONUS_TOKENS, calcEditLimit, formatTokens } from '../src/lib/token-pricing'

describe('token-pricing', () => {
  it('цены по умолчанию', () => {
    expect(TOKEN_PRICES.generate).toBe(100)
    expect(TOKEN_PRICES.uploadEditStart).toBe(50)
    expect(TOKEN_PRICES.rewrite).toBe(100)
    expect(TOKEN_PRICES.editPackage).toBe(100)
    expect(TOKEN_PRICES.review).toBe(25)
    expect(TOKEN_PRICES.analyzeUpload).toBe(25)
    expect(EDITS_PER_PACKAGE).toBe(10)
    expect(WELCOME_BONUS_TOKENS).toBe(500)
  })

  it('лимит правок: пакеты × 10', () => {
    expect(calcEditLimit(2, false)).toBe(20)
    expect(calcEditLimit(1, true)).toBe(10)
  })

  it('лимит правок: сгенерированный до эры токенов документ получает 1 неявный пакет', () => {
    // 0 купленных пакетов, документ НЕ загруженный → неявный бесплатный пакет
    expect(calcEditLimit(0, false)).toBe(10)
    // 0 пакетов, загруженный → правок нет, пока не оплачен старт правок
    expect(calcEditLimit(0, true)).toBe(0)
  })

  it('formatTokens склоняет', () => {
    expect(formatTokens(1)).toBe('1 токен')
    expect(formatTokens(2)).toBe('2 токена')
    expect(formatTokens(100)).toBe('100 токенов')
    expect(formatTokens(21)).toBe('21 токен')
  })
})
```

- [ ] **Step 2: Запустить — убедиться что падает**

Run: `cd apps/web && pnpm exec vitest run tests/token-pricing.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

```ts
// apps/web/src/lib/token-pricing.ts
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
 * packages — число неотменённых списаний, дающих пакет
 * (GENERATE | UPLOAD_EDIT_START | REWRITE | EDIT_PACKAGE).
 * Сгенерированный документ без единого списания — наследие до-токеновой эры:
 * даём один неявный бесплатный пакет. Загруженные без оплаты правок не имеют.
 */
export function calcEditLimit(packages: number, isUploaded: boolean): number {
  const implicit = !isUploaded && packages === 0 ? 1 : 0
  return (packages + implicit) * EDITS_PER_PACKAGE
}

/** «5 токенов» / «21 токен» / «2 токена» */
export function formatTokens(n: number): string {
  const abs = Math.abs(n) % 100
  const d = abs % 10
  const word = abs >= 11 && abs <= 14 ? 'токенов' : d === 1 ? 'токен' : d >= 2 && d <= 4 ? 'токена' : 'токенов'
  return `${n} ${word}`
}
```

- [ ] **Step 4: Тест зелёный**

Run: `pnpm exec vitest run tests/token-pricing.test.ts` → PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/web/src/lib/token-pricing.ts apps/web/tests/token-pricing.test.ts
git commit -m "Токены: единый конфиг цен и лимитов (token-pricing)"
```

---

### Task A2: Схема БД и миграция данных

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Create: миграция `prisma/migrations/*_token_prepaid/migration.sql` (генерирует Prisma, дополняем руками)

**Interfaces:**
- Produces: enum `ChargeKind` (GENERATE | UPLOAD_EDIT_START | REWRITE | EDIT_PACKAGE | REVIEW | ANALYZE), модель `TokenCharge`, enum `Currency` (RUB | TOKEN), `Transaction.currency`, `Document.aiEditsUsed`, модель `VersionDraft` (для фазы B).

- [ ] **Step 1: Правки схемы**

В `schema.prisma` добавить после блока `Transaction`:

```prisma
enum Currency {
  RUB   // legacy-записи до перехода на токены
  TOKEN
}

enum ChargeKind {
  GENERATE          // генерация документа с нуля
  UPLOAD_EDIT_START // старт правок загруженного документа
  REWRITE           // полная переписка загруженного
  EDIT_PACKAGE      // докупка пакета правок
  REVIEW            // проверка на риски
  ANALYZE           // анализ при загрузке файла
}

// Списания токенов — APPEND-ONLY (как версии и согласия).
// Возврат = refundedAt + CREDIT-транзакция, строка не удаляется.
// Число пакетов правок документа = count неотменённых GENERATE/UPLOAD_EDIT_START/REWRITE/EDIT_PACKAGE.
model TokenCharge {
  id         String     @id @default(cuid())
  userId     String
  documentId String?    // null для ANALYZE до создания документа
  versionId  String?    // для GENERATE/REWRITE/REVIEW — какая версия
  kind       ChargeKind
  tokens     Int
  createdAt  DateTime   @default(now())
  refundedAt DateTime?

  @@index([documentId])
  @@index([userId, createdAt])
  @@map("token_charges")
}
```

В модель `Transaction` добавить поле (после `description`):

```prisma
  currency         Currency        @default(TOKEN)
```

В модель `Document` добавить (после `renewalNoticeDays`):

```prisma
  // Использовано ИИ-правок (лимит = пакеты × EDITS_PER_PACKAGE, см. token-pricing.ts)
  aiEditsUsed      Int          @default(0)
```

Добавить модель (после `ShareLink`) — используется фазой B, схему кладём сразу, чтобы была одна миграция:

```prisma
// Рабочая копия документа (несохранённые правки рабочего экрана).
// Одна на документ, при сохранении версии удаляется. НЕ версия — append-only не требуется.
model VersionDraft {
  id            String   @id @default(cuid())
  documentId    String   @unique
  content       String
  baseVersionId String?
  revision      Int      @default(1)
  updatedAt     DateTime @updatedAt

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@map("version_drafts")
}
```

И в модель `Document` — обратную связь: `draft VersionDraft?`.

- [ ] **Step 2: Сгенерировать миграцию (без применения)**

Run: `cd apps/web && pnpm exec prisma migrate dev --name token_prepaid --create-only`

- [ ] **Step 3: Дописать в конец сгенерированного migration.sql миграцию данных**

```sql
-- Существующие транзакции были в рублях
UPDATE "transactions" SET "currency" = 'RUB';

-- Идемпотентность списаний: одно неотменённое GENERATE / UPLOAD_EDIT_START на документ
CREATE UNIQUE INDEX "token_charges_doc_kind_once"
  ON "token_charges" ("documentId", "kind")
  WHERE "kind" IN ('GENERATE', 'UPLOAD_EDIT_START') AND "refundedAt" IS NULL;

-- Единый стартовый баланс: всем кошелькам 500 токенов + CREDIT-запись
UPDATE "wallets" SET "balance" = 500;
INSERT INTO "transactions" ("id", "walletId", "type", "amount", "currency", "description", "createdAt")
SELECT gen_random_uuid()::text, w."id", 'CREDIT', 500, 'TOKEN',
       'Переход на токены: стартовый баланс', NOW()
FROM "wallets" w;
```

- [ ] **Step 4: Применить и проверить**

Run: `pnpm exec prisma migrate dev`
Expected: миграция применилась; `pnpm exec prisma studio` или psql: `SELECT balance FROM wallets LIMIT 3` → 500; `SELECT currency, count(*) FROM transactions GROUP BY 1` → RUB (старые) + TOKEN (новые CREDIT).

- [ ] **Step 5: `pnpm typecheck` → зелёный. Коммит**

```bash
git add apps/web/prisma
git commit -m "Токены: схема TokenCharge/Currency/aiEditsUsed/VersionDraft + миграция балансов"
```

---

### Task A3: Библиотека списаний `token-charges.ts`

**Files:**
- Create: `apps/web/src/lib/token-charges.ts`

**Interfaces:**
- Consumes: `TOKEN_PRICES`, `calcEditLimit` из A1; паттерн `SELECT FOR UPDATE` из `purchase/route.ts:56-93`.
- Produces:
  - `class InsufficientTokensError extends Error { balance: number; required: number }`
  - `chargeTokens(opts): Promise<{ chargeId: string; balance: number; alreadyCharged: boolean }>` где `opts = { userId, kind, tokens, description, documentId?, versionId?, idempotentPerDocument? }`
  - `refundChargeById(chargeId: string, reason: string): Promise<void>` — идемпотентен (повторный вызов no-op)
  - `getEditQuota(documentId: string): Promise<{ limit, used, remaining, packages, isUploaded }>`
  - `isUploadedDocument(documentId: string): Promise<boolean>`
  - `insufficientTokensResponse(err: InsufficientTokensError)` — готовый `NextResponse` 402 `{ error, code: 'INSUFFICIENT_TOKENS', balance, required }`

- [ ] **Step 1: Реализация**

```ts
// apps/web/src/lib/token-charges.ts
import { NextResponse } from 'next/server'
import type { ChargeKind } from '@prisma/client'
import { prisma } from './db'
import { calcEditLimit, formatTokens } from './token-pricing'

export class InsufficientTokensError extends Error {
  constructor(public balance: number, public required: number) {
    super('INSUFFICIENT_TOKENS')
  }
}

const PACKAGE_KINDS: ChargeKind[] = ['GENERATE', 'UPLOAD_EDIT_START', 'REWRITE', 'EDIT_PACKAGE']

/**
 * Списание токенов. ACID: SELECT ... FOR UPDATE на кошелёк (паттерн из бывшего
 * purchase) — параллельные списания сериализуются, баланс не уходит в минус.
 * idempotentPerDocument: если по документу уже есть неотменённое списание того же
 * kind — не списываем повторно (GENERATE, UPLOAD_EDIT_START).
 */
export async function chargeTokens(opts: {
  userId: string
  kind: ChargeKind
  tokens: number
  description: string
  documentId?: string | null
  versionId?: string | null
  idempotentPerDocument?: boolean
}): Promise<{ chargeId: string; balance: number; alreadyCharged: boolean }> {
  const wallet = await prisma.wallet.upsert({
    where: { userId: opts.userId },
    create: { userId: opts.userId, balance: 0 },
    update: {},
  })

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ balance: string }[]>`
      SELECT balance FROM "wallets" WHERE id = ${wallet.id} FOR UPDATE
    `
    const balance = Number(locked[0]?.balance ?? 0)

    if (opts.idempotentPerDocument && opts.documentId) {
      const existing = await tx.tokenCharge.findFirst({
        where: { documentId: opts.documentId, kind: opts.kind, refundedAt: null },
      })
      if (existing) return { chargeId: existing.id, balance, alreadyCharged: true }
    }

    if (balance < opts.tokens) {
      throw new InsufficientTokensError(balance, opts.tokens)
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: opts.tokens } },
    })
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: opts.tokens,
        currency: 'TOKEN',
        description: opts.description,
        relatedVersionId: opts.versionId ?? null,
      },
    })
    const charge = await tx.tokenCharge.create({
      data: {
        userId: opts.userId,
        documentId: opts.documentId ?? null,
        versionId: opts.versionId ?? null,
        kind: opts.kind,
        tokens: opts.tokens,
      },
    })
    return { chargeId: charge.id, balance: Number(updated.balance), alreadyCharged: false }
  })
}

/** Возврат списания (генерация упала и т.п.). Идемпотентен. */
export async function refundChargeById(chargeId: string, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // updateMany с условием refundedAt: null — защита от двойного возврата при гонке
    const res = await tx.tokenCharge.updateMany({
      where: { id: chargeId, refundedAt: null },
      data: { refundedAt: new Date() },
    })
    if (res.count === 0) return
    const charge = await tx.tokenCharge.findUnique({ where: { id: chargeId } })
    if (!charge) return
    const wallet = await tx.wallet.findUnique({ where: { userId: charge.userId } })
    if (!wallet) return
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: charge.tokens } },
    })
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount: charge.tokens,
        currency: 'TOKEN',
        description: `Возврат: ${reason}`,
        relatedVersionId: charge.versionId,
      },
    })
  })
}

/** Загруженный ли документ: у первой версии aiSettings.base === 'upload' */
export async function isUploadedDocument(documentId: string): Promise<boolean> {
  const first = await prisma.version.findFirst({
    where: { documentId },
    orderBy: { number: 'asc' },
    select: { aiSettings: true },
  })
  const s = first?.aiSettings as { base?: string } | null
  return s?.base === 'upload'
}

/** Квота ИИ-правок документа */
export async function getEditQuota(documentId: string) {
  const [doc, packages, isUploaded] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { aiEditsUsed: true } }),
    prisma.tokenCharge.count({
      where: { documentId, refundedAt: null, kind: { in: PACKAGE_KINDS } },
    }),
    isUploadedDocument(documentId),
  ])
  const limit = calcEditLimit(packages, isUploaded)
  const used = doc?.aiEditsUsed ?? 0
  return { limit, used, remaining: Math.max(0, limit - used), packages, isUploaded }
}

export function insufficientTokensResponse(err: InsufficientTokensError) {
  return NextResponse.json(
    {
      error: `Не хватает токенов: нужно ${formatTokens(err.required)}, на балансе ${formatTokens(err.balance)}.`,
      code: 'INSUFFICIENT_TOKENS',
      balance: err.balance,
      required: err.required,
    },
    { status: 402 },
  )
}
```

- [ ] **Step 2: `pnpm typecheck` → зелёный (Prisma client уже перегенерён миграцией)**

- [ ] **Step 3: Коммит**

```bash
git add apps/web/src/lib/token-charges.ts
git commit -m "Токены: библиотека списаний (charge/refund/quota, FOR UPDATE)"
```

---

### Task A4: Регистрация — бонус 500 токенов

**Files:**
- Modify: `apps/web/src/app/api/auth/register/route.ts:27,83-97`

- [ ] **Step 1: Правка**

Заменить `const WELCOME_BONUS = 5000` на импорт:

```ts
import { WELCOME_BONUS_TOKENS } from '@/lib/token-pricing'
```

В транзакции регистрации:

```ts
      const wallet = await tx.wallet.create({
        data: { userId: newUser.id, balance: WELCOME_BONUS_TOKENS },
      })

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amount: WELCOME_BONUS_TOKENS,
          currency: 'TOKEN',
          description: 'Приветственный бонус за регистрацию',
        },
      })
```

- [ ] **Step 2: `pnpm typecheck`. Коммит**

```bash
git commit -am "Токены: приветственный бонус 500 токенов вместо 5000 ₽"
```

---

### Task A5: Списание за генерацию + автовозврат в воркере

**Files:**
- Modify: `apps/web/src/app/api/versions/[id]/generate/route.ts` (перед `queue.add`, строки ~133)
- Modify: `apps/web/src/lib/queue.ts` (тип job-данных, `worker.on('failed')`)

**Interfaces:**
- Consumes: `chargeTokens`, `refundChargeById`, `InsufficientTokensError`, `insufficientTokensResponse` (A3); `TOKEN_PRICES` (A1).
- Produces: `GenerateDocumentJobData.chargeId?: string` — воркер вернёт токены при финальном фейле.

- [ ] **Step 1: generate route — списание перед постановкой в очередь**

После проверки `already_generated` (строка 44) и ДО сборки job-данных вставить (учитывая rewrite из A8 — kind по флагу в aiSettings):

```ts
  // ─── Предоплата токенами ────────────────────────────────────────────────────
  // GENERATE — идемпотентно на документ (ретрай после падения деньги не спишет
  // повторно: возврат снимает идемпотентность через refundedAt).
  // REWRITE (см. /rewrite) — новое списание на каждую переписку, идемпотентно
  // по версии через существующий charge с этим versionId.
  const isRewrite = Boolean((aiSettings as { rewrite?: boolean })?.rewrite)
  let chargeId: string | undefined
  try {
    if (isRewrite) {
      const existing = await prisma.tokenCharge.findFirst({
        where: { versionId: id, kind: 'REWRITE', refundedAt: null },
      })
      chargeId = existing?.id ?? (await chargeTokens({
        userId,
        kind: 'REWRITE',
        tokens: TOKEN_PRICES.rewrite,
        documentId: doc.id,
        versionId: id,
        description: `Переписка документа: ${doc.title}`,
      })).chargeId
    } else {
      const res = await chargeTokens({
        userId,
        kind: 'GENERATE',
        tokens: TOKEN_PRICES.generate,
        documentId: doc.id,
        versionId: id,
        idempotentPerDocument: true,
        description: `Генерация документа: ${doc.title}`,
      })
      chargeId = res.chargeId
    }
  } catch (err) {
    if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
    throw err
  }
```

В `queue.add('generate', { ... })` добавить поле `chargeId`.

- [ ] **Step 2: queue.ts — тип + возврат при финальном фейле**

В `GenerateDocumentJobData` добавить:

```ts
  chargeId?: string          // списание токенов за эту генерацию — вернуть при финальном фейле
```

В `worker.on('failed', ...)` внутри блока `if (isFinalAttempt && job?.data?.versionId)` добавить:

```ts
    if (isFinalAttempt && job?.data?.chargeId) {
      refundChargeById(job.data.chargeId, 'генерация не удалась')
        .catch((e) => logger.error({ event: 'worker.refund_failed', error: e, version_id: job?.data?.versionId }))
    }
```

Импорт в queue.ts: `import { refundChargeById } from './token-charges'`.

- [ ] **Step 3: Проверка**

`pnpm typecheck` зелёный. Ручная проверка (dev): создать документ → генерация → в БД появились `token_charges` (GENERATE, 100) и DEBIT-транзакция, баланс уменьшился; повторный POST /generate не списывает второй раз (`already_generated` или `alreadyCharged`).

- [ ] **Step 4: Коммит**

```bash
git commit -am "Токены: списание за генерацию при постановке в очередь + автовозврат при фейле"
```

---

### Task A6: Чат — пакеты правок вместо лимита «20 на версию»

**Files:**
- Modify: `apps/web/src/app/api/versions/[id]/chat/route.ts`

**Interfaces:**
- Consumes: `getEditQuota`, `chargeTokens`, `InsufficientTokensError`, `insufficientTokensResponse` (A3); `TOKEN_PRICES`, `EDITS_PER_PACKAGE` (A1).
- Produces: 402-ответы `{ code: 'EDIT_PACKAGE_NEEDED', price, limit, used }` и `{ code: 'INSUFFICIENT_TOKENS', ... }`; заголовочные данные квоты в `done`-событии SSE: `{ type: 'done', editsRemaining }`.

- [ ] **Step 1: Снести старый лимит**

Удалить: импорт `isVersionPaid`, константу `FREE_AI_REQUESTS_PER_VERSION` (строки 21), блок «2) Лимит бесплатных ИИ-запросов…» (строки 86-102), `purchase: { select: { id: true } }` из include (строка 64). Rate-limit (п.1) оставить.

- [ ] **Step 2: Новая логика пакетов (только для mode === 'edit')**

После rate-limit-блока и ДО сохранения сообщения пользователя:

```ts
  // ─── Пакеты ИИ-правок (только режим edit; вопросы/анализ бесплатны) ─────────
  const documentId = version.documentId
  if (data.mode === 'edit') {
    let quota = await getEditQuota(documentId)
    // Загруженный документ: первая правка платная — открывает пакет
    if (quota.isUploaded && quota.packages === 0) {
      try {
        await chargeTokens({
          userId,
          kind: 'UPLOAD_EDIT_START',
          tokens: TOKEN_PRICES.uploadEditStart,
          documentId,
          versionId: id,
          idempotentPerDocument: true,
          description: `Правки загруженного документа: ${version.document.title}`,
        })
      } catch (err) {
        if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
        throw err
      }
      quota = await getEditQuota(documentId)
    }
    if (quota.remaining <= 0) {
      return NextResponse.json(
        {
          error: `Пакет из ${EDITS_PER_PACKAGE} ИИ-правок исчерпан. Купите новый пакет, чтобы продолжить.`,
          code: 'EDIT_PACKAGE_NEEDED',
          price: TOKEN_PRICES.editPackage,
          limit: quota.limit,
          used: quota.used,
        },
        { status: 402 },
      )
    }
  }
```

- [ ] **Step 3: Инкремент израсходованных правок при успехе**

В edit-ветке, в месте где сейчас отправляется `explanation = 'Готово — изменения внесены в документ.'` (строка ~164), — правка удалась. Перед `send({ type: 'done', ... })` добавить:

```ts
          const updatedDoc2 = await prisma.document.update({
            where: { id: documentId },
            data: { aiEditsUsed: { increment: 1 } },
            select: { aiEditsUsed: true },
          })
          const quotaAfter = await getEditQuota(documentId)
          send({ type: 'done', updatedDocLength: updatedDoc.length, editsRemaining: quotaAfter.remaining })
```

(ветка `failed || !updatedDoc.trim()` — `__EDIT_FAILED__` — инкремента НЕ делает: неудачная правка пакет не тратит).

- [ ] **Step 4: Проверка**

`pnpm typecheck`. Dev: правка через чат работает, `documents.aiEditsUsed` растёт; режим «Вопрос» не трогает счётчик; для загруженного документа первая правка создаёт charge UPLOAD_EDIT_START на 50.

- [ ] **Step 5: Коммит**

```bash
git commit -am "Токены: пакеты правок в чате вместо лимита 20 на версию"
```

---

### Task A7: API квоты и докупки пакета

**Files:**
- Create: `apps/web/src/app/api/documents/[id]/edit-quota/route.ts`
- Create: `apps/web/src/app/api/documents/[id]/edit-package/route.ts`

**Interfaces:**
- Produces: `GET /api/documents/:id/edit-quota` → `{ limit, used, remaining, packages, isUploaded, prices: { editPackage, uploadEditStart, generate, rewrite, review } }`; `POST /api/documents/:id/edit-package` → `{ ok: true, balance, quota }`.

- [ ] **Step 1: edit-quota**

```ts
// apps/web/src/app/api/documents/[id]/edit-quota/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getEditQuota } from '@/lib/token-charges'
import { TOKEN_PRICES } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

// GET /api/documents/:id/edit-quota — квота ИИ-правок + цены для UI
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const quota = await getEditQuota(id)
  return NextResponse.json({
    ...quota,
    prices: {
      editPackage: TOKEN_PRICES.editPackage,
      uploadEditStart: TOKEN_PRICES.uploadEditStart,
      generate: TOKEN_PRICES.generate,
      rewrite: TOKEN_PRICES.rewrite,
      review: TOKEN_PRICES.review,
    },
  })
}
```

- [ ] **Step 2: edit-package**

```ts
// apps/web/src/app/api/documents/[id]/edit-package/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { chargeTokens, getEditQuota, InsufficientTokensError, insufficientTokensResponse } from '@/lib/token-charges'
import { TOKEN_PRICES, EDITS_PER_PACKAGE } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

// POST /api/documents/:id/edit-package — докупить пакет ИИ-правок
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true, title: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const res = await chargeTokens({
      userId,
      kind: 'EDIT_PACKAGE',
      tokens: TOKEN_PRICES.editPackage,
      documentId: id,
      description: `Пакет ${EDITS_PER_PACKAGE} ИИ-правок: ${doc.title}`,
    })
    const quota = await getEditQuota(id)
    return NextResponse.json({ ok: true, balance: res.balance, quota }, { status: 201 })
  } catch (err) {
    if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
    throw err
  }
}
```

- [ ] **Step 3: `pnpm typecheck`, dev-проверка curl'ом обоих маршрутов. Коммит**

```bash
git add apps/web/src/app/api/documents/\[id\]/edit-quota apps/web/src/app/api/documents/\[id\]/edit-package
git commit -m "Токены: API квоты правок и докупки пакета"
```

---

### Task A8: «Переписать заново» загруженный документ

**Files:**
- Create: `apps/web/src/app/api/documents/[id]/rewrite/route.ts`

**Interfaces:**
- Consumes: паттерн append-only из `documents/[id]/versions/route.ts` (nextNumber, сброс статусов); генерация — существующий `POST /api/versions/:id/generate` (клиент вызовет его сам после создания версии; списание REWRITE произойдёт там по флагу `aiSettings.rewrite` — см. A5).
- Produces: `POST /api/documents/:id/rewrite { instruction?: string }` → `201 { versionId, price }` — новая версия с `aiSettings.rewrite = true` и `referenceContent` = текст последней версии. Клиент затем зовёт `/api/versions/:versionId/generate`.

- [ ] **Step 1: Реализация**

```ts
// apps/web/src/app/api/documents/[id]/rewrite/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { isUploadedDocument } from '@/lib/token-charges'
import { TOKEN_PRICES } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ instruction: z.string().max(4000).optional() })

// POST /api/documents/:id/rewrite — «Переписать заново»: новая версия (append-only)
// с referenceContent = текст последней версии и флагом rewrite. Списание REWRITE
// делает /api/versions/:id/generate по этому флагу — здесь только подготовка версии.
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await isUploadedDocument(id))) {
    return NextResponse.json({ error: 'Переписать заново можно только загруженный документ' }, { status: 400 })
  }

  const data = schema.parse(await req.json().catch(() => ({})))

  const last = await prisma.version.findFirst({
    where: { documentId: id },
    orderBy: { number: 'desc' },
  })
  if (!last?.content) return NextResponse.json({ error: 'Нет текста для переписки' }, { status: 400 })

  const prevSettings = last.aiSettings as Record<string, unknown>
  await prisma.version.updateMany({
    where: { documentId: id, status: { notIn: ['SIGNED', 'PAID'] } },
    data: { status: 'DRAFT' },
  })
  const version = await prisma.version.create({
    data: {
      documentId: id,
      number: last.number + 1,
      status: 'DRAFT',
      aiSettings: {
        ...prevSettings,
        rewrite: true,
        referenceContent: last.content,
        customInstruction: data.instruction ?? (prevSettings.customInstruction as string | undefined) ?? '',
      },
    },
  })

  return NextResponse.json({ versionId: version.id, price: TOKEN_PRICES.rewrite }, { status: 201 })
}
```

- [ ] **Step 2: `pnpm typecheck`. Dev: rewrite → generate списывает REWRITE 100 один раз (повторный POST /generate той же версии — не списывает). Коммит**

```bash
git add apps/web/src/app/api/documents/\[id\]/rewrite
git commit -m "Токены: «Переписать заново» загруженный документ (REWRITE)"
```

---

### Task A9: Списания за проверку и анализ загрузки

**Files:**
- Modify: `apps/web/src/app/api/versions/[id]/review/route.ts` (AI-вызов на строке ~54)
- Modify: `apps/web/src/app/api/documents/analyze/route.ts` (AI-вызов на строке ~72)

- [ ] **Step 1: review — списание перед ИИ, возврат при ошибке**

Перед `withLoggedAIContext('review', ...)`:

```ts
  let reviewChargeId: string | null = null
  try {
    const res = await chargeTokens({
      userId,
      kind: 'REVIEW',
      tokens: TOKEN_PRICES.review,
      documentId: version.documentId,
      versionId: id,
      description: `Проверка на риски: ${version.document.title}`,
    })
    reviewChargeId = res.chargeId
  } catch (err) {
    if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
    throw err
  }
```

Обернуть ИИ-вызов в try/catch; в catch перед прокидыванием ошибки/ответом 500:

```ts
    if (reviewChargeId) await refundChargeById(reviewChargeId, 'проверка не выполнена')
```

(если в маршруте уже есть catch — добавить возврат туда; если проверка стримится — возврат в catch стрима).

- [ ] **Step 2: analyze — то же самое, kind ANALYZE, documentId: null**

```ts
  let analyzeChargeId: string | null = null
  try {
    const res = await chargeTokens({
      userId,
      kind: 'ANALYZE',
      tokens: TOKEN_PRICES.analyzeUpload,
      description: 'Анализ загруженного документа',
    })
    analyzeChargeId = res.chargeId
  } catch (err) {
    if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
    throw err
  }
```

Возврат `refundChargeById(analyzeChargeId, 'анализ не выполнен')` — в catch вокруг ИИ-вызова/стрима.

- [ ] **Step 3: `pnpm typecheck`. Dev: проверка списывает 25, анализ — 25; обрыв ИИ возвращает токены. Коммит**

```bash
git commit -am "Токены: списания за проверку на риски и анализ загрузки с возвратом при ошибке"
```

---

### Task A10: Демонтаж постоплаты на сервере

**Files:**
- Delete: `apps/web/src/app/api/versions/[id]/purchase/route.ts`, `apps/web/src/lib/version-payment.ts`, `apps/web/src/lib/pricing.ts`
- Modify: `apps/web/src/app/api/versions/[id]/download/route.ts:45-47`
- Modify: `apps/web/src/app/api/versions/[id]/status/route.ts`
- Modify: `apps/web/src/app/api/documents/[id]/versions/route.ts` (schema: убрать `'PAID'` из допустимых статусов)

- [ ] **Step 1: Удалить purchase route, version-payment.ts, pricing.ts**

```bash
rm apps/web/src/app/api/versions/\[id\]/purchase/route.ts
rmdir apps/web/src/app/api/versions/\[id\]/purchase
rm apps/web/src/lib/version-payment.ts apps/web/src/lib/pricing.ts
```

- [ ] **Step 2: download — убрать гейт оплаты**

Удалить блок (строки 45-47):

```ts
if (!version.purchase) {
  return NextResponse.json({ error: 'Версия не оплачена...' }, { status: 403 })
}
```

и `purchase: true` из include выше, если больше не используется.

- [ ] **Step 3: status route — SIGNED без оплаты**

Убрать импорт `isVersionPaid` и оба блока с ним. Новое правило после проверки `version.status === 'SIGNED'`:

```ts
  // Подписать можно утверждённую версию (или legacy-оплаченную).
  if (data.status === 'SIGNED' && !['APPROVED', 'PAID'].includes(version.status)) {
    return NextResponse.json({ error: 'Подписать можно только утверждённую версию' }, { status: 400 })
  }
```

Убрать `include: { purchase: true }`.

- [ ] **Step 4: versions POST — убрать `'PAID'` из z.enum статусов**

- [ ] **Step 5: Найти оставшиеся ссылки**

Run: `grep -rn "version-payment\|isVersionPaid\|calcVersionPrice\|/purchase" apps/web/src --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: остаются только клиентские файлы (work/page.tsx, documents/[id]/page.tsx, new/page.tsx) — их чинит A11. Починить прочие серверные, если найдутся.

- [ ] **Step 6: Коммит (typecheck упадёт на клиенте — это ок, чинится A11; коммитим вместе с A11 если ломает CI, иначе отдельно)**

Если `pnpm typecheck` красный только из-за клиентских страниц — выполнить A11 до коммита и закоммитить одним коммитом:

```bash
git add -A && git commit -m "Демонтаж постоплаты: purchase API, гейты скачивания и статусов"
```

---

### Task A11: Демонтаж постоплаты в UI + новые элементы токенов

**Files:**
- Modify: `apps/web/src/app/(app)/documents/[id]/work/page.tsx`
- Modify: `apps/web/src/app/(app)/documents/[id]/page.tsx`
- Modify: `apps/web/src/app/(app)/documents/new/page.tsx:1411` (прогнозная цена)
- Modify: `apps/web/src/components/document-viewer.tsx:81-85`

**Interfaces:**
- Consumes: `GET /api/documents/:id/edit-quota` (A7), `POST /api/documents/:id/edit-package` (A7), `POST /api/documents/:id/rewrite` (A8), SSE `{ type:'done', editsRemaining }` (A6), 402-коды `EDIT_PACKAGE_NEEDED` / `INSUFFICIENT_TOKENS`.

- [ ] **Step 1: document-viewer.tsx — убрать блокировку копирования**

Удалить проп `canCopy` и стили/обработчики `userSelect` / `onCopy` (строки 81-85). Также удалить легаси `DocumentRenderer_LEGACY` в work/page.tsx (строки 255-322), если он ещё там.

- [ ] **Step 2: work/page.tsx — снос постоплаты**

Удалить: `paidClean`/`isPurchased`/`purchased`-стейт (строки ~986-992), водяной знак «ЧЕРНОВИК» (строки ~1299-1309), гейт печати (`disabled={!paidClean}` → всегда доступна), `purchaseVersion()` (строки ~886-921), модалку покупки (строки ~1541-1610), кнопки «Купить · N ₽» (строки ~1196-1198), импорт `calcVersionPrice`, клиентскую константу `FREE_AI_REQUESTS_PER_VERSION` и её плашку (строки ~998-1001, 1472-1481), `canCopy={paidClean}` (строка ~1324).

- [ ] **Step 3: work/page.tsx — счётчик пакета и докупка**

Добавить загрузку квоты (`useEffect` + fetch `/api/documents/${docId}/edit-quota`) в стейт `editQuota`. Обновлять из SSE-события `done` (поле `editsRemaining`). Рядом с полем чата — бейдж:

```tsx
{editQuota && chatMode === 'edit' && (
  <span className="text-xs text-muted-foreground">
    Правок осталось: {editQuota.remaining} из {editQuota.limit}
  </span>
)}
```

Обработка 402 в `sendMessage`: `code === 'EDIT_PACKAGE_NEEDED'` → плашка с кнопкой «Купить пакет 10 правок · N токенов» → `POST /api/documents/:id/edit-package` → обновить квоту и баланс (walletStore); `code === 'INSUFFICIENT_TOKENS'` → сообщение WARNING с текстом ошибки.

- [ ] **Step 4: work/page.tsx — кнопка «Переписать заново» (только загруженные)**

Если `editQuota?.isUploaded` — в меню действий кнопка «Переписать заново · N токенов» → confirm-диалог → `POST /api/documents/:id/rewrite` → `POST /api/versions/:versionId/generate` → редирект на рабочий экран новой версии (существующий поллинг jobId подхватит).

- [ ] **Step 5: documents/[id]/page.tsx — снос покупки**

Удалить модалку покупки (строка ~230), кнопки «Купить» (строки ~398-410, 480-487), обработчик (строка ~560), импорт `calcVersionPrice`. Кнопка «Скачать» — для любой версии с контентом.

- [ ] **Step 6: new/page.tsx — цена генерации**

Заменить прогноз `calcVersionPrice(...)` (строка ~1411) на фиксированную цену из квоты-API нельзя (документа ещё нет) — захардкодить текст из констант нельзя (серверный конфиг). Решение: добавить в существующий публичный ответ `GET /api/wallet` поле `prices` (см. A12) и показывать «Генерация — N токенов» на кнопке запуска.

- [ ] **Step 7: Проверка**

`pnpm typecheck && pnpm lint` зелёные. Dev-прогон: рабочий экран без водяного знака, текст выделяется/копируется, печать доступна, счётчик правок виден, покупок нигде нет.

- [ ] **Step 8: Коммит**

```bash
git add -A && git commit -m "UI: демонтаж постоплаты, счётчик пакета правок, докупка и переписка"
```

---

### Task A12: Баланс, топбар и история — токены

**Files:**
- Modify: `apps/web/src/app/api/wallet/route.ts` — добавить в ответ `prices` (все `TOKEN_PRICES`) и `currency: 'TOKEN'`
- Modify: `apps/web/src/app/api/wallet/transactions/route.ts` — в items добавить `currency: t.currency`
- Modify: `apps/web/src/app/(app)/balance/page.tsx`, `apps/web/src/app/(app)/payments/page.tsx` — форматирование
- Modify: топбар/walletStore (`apps/web/src/components/**` где рендерится баланс; найти: `grep -rn "₽" apps/web/src/components apps/web/src/app/\(app\)`)

- [ ] **Step 1: API-правки** (тривиальные, по описанию выше)

- [ ] **Step 2: UI**

Везде, где баланс показывался как `N ₽` — показывать `formatTokens(N)` (функция чистая, импортируется на клиент из `@/lib/token-pricing`). В истории платежей: суммы с суффиксом `₽` только для `currency === 'RUB'` (легаси), иначе «токенов». Тексты страницы баланса переписать: «Токены списываются за генерацию, правки сверх пакета, проверку и анализ. Пополнение скоро откроется».

- [ ] **Step 3: Проверка + коммит**

Dev: топбар и /balance показывают «500 токенов», история — старые записи в ₽ с пометкой, новые в токенах.

```bash
git add -A && git commit -m "UI: баланс и история операций в токенах"
```

---

### Task A13: Документация и ENV

**Files:**
- Modify: `CLAUDE.md` — правило 4 («Покупка версии — транзакция БД») заменить на «Списания токенов — транзакция БД с SELECT FOR UPDATE (lib/token-charges.ts); TokenCharge append-only»; обновить e2e-сценарий (шаги 9-10: утверждение без списания, скачивание свободно); добавить фазу 16 с задачами этого плана и статусами.
- Modify: `apps/web/.env.example` (или корневой `.env.example`) — добавить `TOKEN_PRICE_GENERATE=100`, `TOKEN_PRICE_UPLOAD_EDIT_START=50`, `TOKEN_PRICE_REWRITE=100`, `TOKEN_PRICE_EDIT_PACKAGE=100`, `TOKEN_PRICE_REVIEW=25`, `TOKEN_PRICE_ANALYZE_UPLOAD=25`, `TOKEN_EDITS_PER_PACKAGE=10`, `WELCOME_BONUS_TOKENS=500`; удалить `FREE_AI_EDITS_PER_VERSION`.

- [ ] **Step 1: Правки. Step 2: Коммит**

```bash
git add -A && git commit -m "Докум.: правила токенов в CLAUDE.md, ENV-переменные цен"
```

**Чекпоинт фазы A:** `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` зелёные; e2e-сценарий спеки пункты 1-5, 8 проходят вручную на dev.

---

# Фаза B — редактируемый предпросмотр

### Task B1: Настоящий серверный черновик

**Files:**
- Modify: `apps/web/src/app/api/documents/[id]/draft/route.ts` (сейчас заглушка)

**Interfaces:**
- Consumes: модель `VersionDraft` (A2).
- Produces: `GET` → `{ content, baseVersionId, revision, updatedAt } | null`; `PUT { content, baseVersionId?, revision? }` → `{ revision, updatedAt }` (409 при конфликте ревизий); `DELETE` → `{ ok: true }`.

- [ ] **Step 1: Реализация**

```ts
// GET
  const draft = await prisma.versionDraft.findUnique({ where: { documentId: id } })
  return NextResponse.json(draft ? {
    content: draft.content,
    baseVersionId: draft.baseVersionId,
    revision: draft.revision,
    updatedAt: draft.updatedAt,
  } : null)

// PUT (вместо `return NextResponse.json({ revision: 1, ... })`)
  const existing = await prisma.versionDraft.findUnique({ where: { documentId: id } })
  // Конфликт ревизий: другая вкладка сохранила позже
  if (existing && data.revision != null && data.revision < existing.revision) {
    return NextResponse.json({ error: 'Черновик изменён в другой вкладке', code: 'DRAFT_CONFLICT', revision: existing.revision }, { status: 409 })
  }
  const draft = await prisma.versionDraft.upsert({
    where: { documentId: id },
    create: { documentId: id, content: data.content, baseVersionId: data.baseVersionId ?? null },
    update: { content: data.content, baseVersionId: data.baseVersionId ?? null, revision: { increment: 1 } },
  })
  return NextResponse.json({ revision: draft.revision, updatedAt: draft.updatedAt })

// DELETE
  await prisma.versionDraft.deleteMany({ where: { documentId: id } })
  return NextResponse.json({ ok: true })
```

- [ ] **Step 2: Проверка**

Dev: правка в рабочем экране → PUT сохраняет строку в `version_drafts`; перезагрузка страницы восстанавливает черновик (клиентская логика восстановления уже есть — `work/page.tsx:561-580`); сохранение версии удаляет черновик.

- [ ] **Step 3: Коммит**

```bash
git commit -am "Черновик: настоящее сохранение рабочей копии вместо заглушки"
```

---

### Task B2: Редактируемый DocumentViewer + тулбар

**Files:**
- Modify: `apps/web/src/components/document-viewer.tsx`
- Create: `apps/web/src/components/editor-toolbar.tsx`

**Interfaces:**
- Produces: `DocumentViewer` пропы: `content: string`, `editable?: boolean`, `onUpdate?: (html: string) => void`, `externalContentKey?: string | number` (сигнал «контент пришёл извне — заменить содержимое редактора»). `EditorToolbar { editor: Editor | null }`.

- [ ] **Step 1: document-viewer.tsx**

```tsx
// ключевые изменения:
const editor = useEditor({
  extensions,           // существующие StarterKit + Table*
  content: processed,   // существующий пайплайн sanitize→normalize→layout
  editable: Boolean(editable),
  onUpdate: editable && onUpdate
    ? ({ editor }) => onUpdate(editor.getHTML())
    : undefined,
  immediatelyRender: false,
})

// Замена контента ТОЛЬКО когда изменение пришло извне (ИИ-стрим, смена версии),
// а не эхо собственного onUpdate — иначе курсор прыгает на каждом символе.
useEffect(() => {
  if (!editor) return
  if (editor.getHTML() === processed) return
  editor.commands.setContent(processed, { emitUpdate: false })
}, [externalContentKey])  // намеренно НЕ по processed: родитель меняет ключ при внешнем изменении
```

`editable` меняется через `editor.setEditable(editable)` в отдельном `useEffect`.

- [ ] **Step 2: editor-toolbar.tsx**

```tsx
'use client'
import type { Editor } from '@tiptap/react'

const BTN = 'px-2 py-1 rounded text-sm hover:bg-black/5 data-[active=true]:bg-black/10 data-[active=true]:font-semibold'

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const items: Array<{ label: string; title: string; active: boolean; run: () => void }> = [
    { label: 'Ж', title: 'Жирный', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'К', title: 'Курсив', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'H2', title: 'Заголовок раздела', active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'H3', title: 'Подзаголовок', active: editor.isActive('heading', { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: '•', title: 'Маркированный список', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Нумерованный список', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '↶', title: 'Отменить', active: false, run: () => editor.chain().focus().undo().run() },
    { label: '↷', title: 'Повторить', active: false, run: () => editor.chain().focus().redo().run() },
  ]
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1 shadow-sm" style={{ fontFamily: 'var(--font-sans)' }}>
      {items.map((b) => (
        <button key={b.title} type="button" title={b.title} data-active={b.active} className={BTN}
          onMouseDown={(e) => { e.preventDefault(); b.run() }}>
          {b.label}
        </button>
      ))}
    </div>
  )
}
```

(Кнопки — только то, что переживает экспорт в DOCX: bold, italic, заголовки, списки. Стили подогнать под tokens.css при интеграции.)

- [ ] **Step 3: `pnpm typecheck`. Коммит**

```bash
git add apps/web/src/components && git commit -m "Предпросмотр: TipTap-редактор с мини-тулбаром"
```

---

### Task B3: Интеграция редактора в рабочий экран

**Files:**
- Modify: `apps/web/src/app/(app)/documents/[id]/work/page.tsx`

**Interfaces:**
- Consumes: `DocumentViewer` с `editable/onUpdate/externalContentKey` (B2), `EditorToolbar` (B2), черновик (B1).

- [ ] **Step 1: Состояние**

- `docContent` остаётся источником истины для сохранения/черновика.
- Внешние изменения (ИИ-стрим `{type:'doc'}`, восстановление черновика, смена версии) — инкрементируют `externalKey` (счётчик в `useRef`/`useState`) и обновляют `docContent`; viewer перезагружает контент.
- Ручной ввод: `onUpdate` пишет `docContent`, ставит `hasUnsavedEdits`, дёргает существующий `scheduleAutosave` — `externalKey` НЕ меняет.
- Во время стрима генерации/правки редактирование выключено: `editable={!isStreaming}`.

- [ ] **Step 2: Разметка**

Над «листом» — `EditorToolbar` (получает editor через ref/проп из viewer — экспортировать `onEditorReady?: (e: Editor) => void`). «Лист» визуально освежить: убрать `overflow: hidden` (мешает выпадающим меню), тень листа `shadow-md`, отступы прежние.

- [ ] **Step 3: Сохранение**

`persistEditsAsNewVersion()` уже отправляет `docContent` — работает без изменений; после успеха `DELETE /draft` уже есть.

- [ ] **Step 4: Проверка (dev, вручную)**

- Ручная правка текста → бейдж «несохранённые правки», автосейв (Network: PUT /draft 200).
- ИИ-правка через чат стримится в редактор, курсор не прыгает при ручном вводе.
- «Сохранить» → новая версия с ручными правками, черновик удалён.
- Перезагрузка с несохранёнными правками → восстановление из черновика.
- Скачивание DOCX сохранённой версии — жирный/курсив на месте.

- [ ] **Step 5: Коммит**

```bash
git commit -am "Рабочий экран: редактируемый предпросмотр (ручные правки + ИИ в одном редакторе)"
```

**Чекпоинт фазы B:** e2e-пункт 6 спеки проходит.

---

# Фаза C — шапка и реквизиты как слой

### Task C1: Воркер генерирует только тело + хелпер совместимости

**Files:**
- Modify: `apps/web/src/lib/queue.ts:172-218`
- Modify: `apps/web/src/lib/html-document.ts` — добавить `hasInlineRequisites`
- Test: `apps/web/tests/decor-layer.test.ts`

**Interfaces:**
- Produces: `hasInlineRequisites(content: string): boolean` — в тексте версии уже есть вклеенный блок реквизитов (legacy-версии). Использует существующий `splitRequisitesBlock`.

- [ ] **Step 1: Тест хелпера**

```ts
// apps/web/tests/decor-layer.test.ts
import { describe, it, expect } from 'vitest'
import { hasInlineRequisites, buildRequisitesHtml } from '../src/lib/html-document'

describe('hasInlineRequisites', () => {
  it('находит вклеенный блок реквизитов', () => {
    const reqs = buildRequisitesHtml(
      { name: 'ООО Ромашка', inn: '7700000000' } as never,
      { name: 'ИП Иванов', inn: '770000000000' } as never,
      'Заказчик', 'Исполнитель',
    )
    expect(hasInlineRequisites(`<h2>1. Предмет</h2><p>Текст.</p>${reqs}`)).toBe(true)
  })
  it('не срабатывает на теле без блока', () => {
    expect(hasInlineRequisites('<h2>1. Предмет</h2><p>Реквизиты сторон могут быть изменены.</p>')).toBe(false)
  })
})
```

Run → FAIL (функции нет).

- [ ] **Step 2: Хелпер в html-document.ts**

```ts
/** Legacy-версии (до слоя оформления) содержат блок реквизитов прямо в content. */
export function hasInlineRequisites(content: string): boolean {
  return Boolean(splitRequisitesBlock(content).requisites)
}
```

(если `splitRequisitesBlock` возвращает другую форму — подстроить: критерий «блок найден».)

- [ ] **Step 3: Тест зелёный. Воркер**

В `queue.ts` внутри `if (userProfile && counterpartyData)` (строка 177): **оставить** зачистку ИИ-мусора (`stripAiRequisitesBlock`, markdown-fallback regex, `stripAiPreamble`), **удалить** подстановку:

```ts
        // Преамбулу и блок реквизитов больше НЕ приклеиваем: они — слой документа
        // (Document.preambleHtml/requisitesHtml), подставляются при показе и экспорте.
        // Здесь только вычищаем то, что ИИ написал вопреки инструкции.
```

Удалить строки `finalText = \`${preambleHtml}\n${finalText}\`` и `finalText += \`\n${reqsHtml}\``, вычисление `preambleHtml`/`reqsHtml`, поля `preambleHtml`/`requisitesHtml` из `GenerateDocumentJobData` и их передачу из generate route (`generate/route.ts:163-164`) — воркеру они больше не нужны.

- [ ] **Step 4: `pnpm test:run && pnpm typecheck`. Коммит**

```bash
git add -A && git commit -m "Оформление: воркер генерирует только тело, hasInlineRequisites для legacy"
```

---

### Task C2: API слоя оформления

**Files:**
- Create: `apps/web/src/app/api/documents/[id]/decor/route.ts`

**Interfaces:**
- Consumes: `buildContractPreambleHtml`, `buildChildDocPreambleHtml`, `buildRequisitesHtml` (`html-document.ts`), `resolveDocumentProfile`, `resolveCounterpartySignatory` (`party-data.ts`), `rolesFor`-логика из `presentation-content.ts`.
- Produces:
  - `GET /api/documents/:id/decor` → `{ preambleHtml, requisitesHtml, confirmed: boolean }` (confirmed = блоки сохранены на документе)
  - `POST /api/documents/:id/decor { profileId?, signatoryId?, city?, signingDate?, preview?: boolean }` → строит блоки из карточек; `preview: true` — только вернуть, иначе сохранить в `Document.preambleHtml/requisitesHtml` (+ `profileId`/`signingDate` на документ) и вернуть.
  - `PATCH /api/documents/:id/decor { preambleHtml?, requisitesHtml? }` → сохранить отредактированные вручную блоки (санитизировать `sanitizeHtml`).
  - `DELETE /api/documents/:id/decor` → очистить блоки (скачивание «без шапки» по умолчанию).

- [ ] **Step 1: Реализация**

Скелет (сборка повторяет логику `generate/route.ts:52-115` — вынести общее в `apps/web/src/lib/party-data.ts` функцией `buildPartiesForDocument(documentId, userId, profileIdOverride?, signatoryIdOverride?)`, возвращающей `{ userProfile, counterpartyData, role1, role2, city }`, и переиспользовать её в generate route вместо дублирования):

```ts
// POST — построить (и опционально сохранить)
const { userProfile, counterpartyData, role1, role2, city } = await buildPartiesForDocument(id, userId, data.profileId, data.signatoryId)
const chosenCity = data.city ?? city
const signingDate = data.signingDate ?? doc.signingDate?.toISOString()
const preambleHtml = doc.type === 'CONTRACT'
  ? buildContractPreambleHtml(userProfile, counterpartyData, role1, role2, chosenCity, signingDate)
  : buildChildDocPreambleHtml(userProfile, counterpartyData, role1, role2, doc.type, doc.documentNumber ?? undefined, doc.parentDocument?.number ?? undefined, doc.parentDocument?.title ?? undefined, chosenCity, signingDate)
const requisitesHtml = buildRequisitesHtml(userProfile, counterpartyData, role1, role2)
if (!data.preview) {
  await prisma.document.update({ where: { id }, data: { preambleHtml, requisitesHtml, ...(data.profileId ? { profileId: data.profileId } : {}), ...(data.signingDate ? { signingDate: new Date(data.signingDate) } : {}) } })
}
return NextResponse.json({ preambleHtml, requisitesHtml, confirmed: !data.preview })
```

Все ветки — с owner-скоупом `findFirst({ where: { id, userId } })`.

- [ ] **Step 2: `pnpm typecheck`, dev-curl всех методов. Коммит**

```bash
git add -A && git commit -m "Оформление: API decor — построение, сохранение и правка шапки/реквизитов"
```

---

### Task C3: Мастер создания — убрать замороженную шапку

**Files:**
- Modify: `apps/web/src/app/(app)/documents/new/page.tsx:483-500, 741-796, 1486-1487`
- Modify: `apps/web/src/app/api/documents/route.ts:27-28, 176-177`

- [ ] **Step 1: Мастер**

Удалить: блок редактируемого предпросмотра шапки (строки ~741-796), автозаполнение `preambleEdited`/`requisitesEdited` (строки ~483-500), отправку `preambleHtml`/`requisitesHtml` при создании (строки ~1486-1487). Выбор профиля/контрагента/подписанта/даты — оставить как есть.

- [ ] **Step 2: documents POST**

Убрать `preambleHtml`/`requisitesHtml` из zod-схемы и `create` (поля в БД остаются — их пишет decor API).

- [ ] **Step 3: `pnpm typecheck`. Dev: создание документа проходит, генерация даёт тело без шапки. Коммит**

```bash
git commit -am "Мастер: шапка/реквизиты больше не замораживаются на шаге создания"
```

---

### Task C4: Рабочий экран — блоки оформления вокруг тела

**Files:**
- Modify: `apps/web/src/app/(app)/documents/[id]/work/page.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/documents/:id/decor` (C2), `hasInlineRequisites` (C1).

- [ ] **Step 1: Загрузка и рендер**

- Fetch `GET /decor` вместе с версией. Если `hasInlineRequisites(docContent)` (legacy-версия) — блоки НЕ показывать (они уже в теле). Клиентский детект: сервер возвращает флаг `legacyInline` в `GET /api/versions/:id` (добавить туда `legacyInline: hasInlineRequisites(version.content ?? '')`).
- Иначе: над TipTap-редактором — div с `dangerouslySetInnerHTML` преамбулы, под ним — блок реквизитов; оба с рамкой-подсветкой при наведении и подписью «Оформление · редактировать».
- Клик — блок становится `contentEditable`, по blur — `PATCH /decor` с новым HTML.
- Если блоков нет (`preambleHtml == null`) — тонкая плашка «Шапка и реквизиты добавятся при скачивании» + кнопка «Настроить сейчас» (открывает модалку C5).

- [ ] **Step 2: Проверка**

Dev: новый документ → тело в редакторе, плашка про оформление; после C5-модалки блоки видны и редактируются; legacy-документ показывается как раньше (без задвоения).

- [ ] **Step 3: Коммит**

```bash
git commit -am "Рабочий экран: блоки шапки и реквизитов как слой вокруг тела"
```

---

### Task C5: Шаг «Оформление» перед скачиванием + download по слоям

**Files:**
- Create: `apps/web/src/components/decor-modal.tsx`
- Modify: `apps/web/src/app/(app)/documents/[id]/work/page.tsx` (обработчик скачивания, строки ~942-960), `apps/web/src/app/(app)/documents/[id]/page.tsx` (строки ~328-336, 865-872)
- Modify: `apps/web/src/app/api/versions/[id]/download/route.ts`

**Interfaces:**
- Consumes: `POST /decor` с `preview` (C2), `hasInlineRequisites` (C1).
- Produces: `DecorModal { documentId, open, onClose, onConfirmed }` — выбор профиля (`GET /api/profiles`), подписанта контрагента (`GET /api/counterparties/:id/signatories`), город, дата; предпросмотр через `POST /decor { preview: true }`; «Подтвердить и скачать» → `POST /decor` (сохранение) → `onConfirmed()`. Кнопка «Скачать без шапки» → `onConfirmed({ bare: true })`.

- [ ] **Step 1: Модалка** (по паттерну существующих модалок work/page; одна primary-кнопка «Подтвердить и скачать»)

- [ ] **Step 2: Клиентский флоу скачивания**

`downloadVersion()`: если у документа нет сохранённых decor-блоков И версия не legacy (`!legacyInline`) — открыть DecorModal; после подтверждения (или «без шапки» → `?bare=1`) — существующий fetch download. Если блоки уже сохранены — качать сразу; в меню — пункт «Оформление…» для повторного открытия модалки.

- [ ] **Step 3: download route по слоям**

- Убрать сборку сторон/`makeParty`/`resolveCounterpartySignatory`-логику подстановки для новых версий: если `hasInlineRequisites(content)` (legacy) — текущий код-путь как есть; иначе:

```ts
const bare = req.nextUrl.searchParams.get('bare') === '1'
const preamble = !bare && doc.preambleHtml ? doc.preambleHtml : undefined
const requisites = !bare && doc.requisitesHtml ? doc.requisitesHtml : undefined
// convertToDocx(content, { ...opts }) — передать preamble/requisites как готовые HTML-блоки
```

`convertToDocx` сейчас принимает структурированные `RequisitesParty` — проверить `packages/shared/src/formatting/html-docx-converter.ts:17-56`: если готовый HTML блока реквизитов конвертер не принимает, НЕ расширять его — вместо этого передавать на вход `content = preambleHtml + body + requisitesHtml` (конкатенация санитизированного HTML: конвертер уже умеет `doc-preamble-meta`, `doc-requisites`-div'ы через `buildBlocks`/`buildRequisitesTable`), а opts.preamble/opts.requisites не задавать.

- Для загруженных документов (`looksLikeUpload`) поведение прежнее: ничего не подставляется, если пользователь не сохранил decor-блоки явно.

- [ ] **Step 4: Проверка**

Dev: первое скачивание нового документа → модалка → DOCX с шапкой (город/дата табстопом), телом и реквизитами двух колонок; повторное скачивание — сразу; «без шапки» — только тело; legacy-версия качается как раньше; жирный/курсив в теле сохранены.

- [ ] **Step 5: Коммит**

```bash
git add -A && git commit -m "Оформление: шаг перед скачиванием, DOCX собирается из слоёв"
```

---

### Task C6: Единый показ слоёв: предпросмотр версии и публичная ссылка

**Files:**
- Modify: `apps/web/src/app/api/versions/[id]/route.ts:52-59`
- Modify: `apps/web/src/app/api/share/[token]/route.ts:49-58`
- Modify: `apps/web/src/lib/presentation-content.ts`

**Interfaces:**
- Produces: `assemblePresentation(documentId, versionContent, userRole): Promise<string>` в `presentation-content.ts` — для legacy-контента (`hasInlineRequisites`) возвращает существующий `getPresentationContent`-путь; для нового тела возвращает `preambleHtml + body + requisitesHtml` из `Document` (без блоков, если не заполнены).

- [ ] **Step 1: Хелпер + оба маршрута на него**

`GET /api/versions/:id` дополнительно возвращает `bodyContent` (чистое тело для редактора) и `legacyInline` — рабочий экран (C4) использует их; собранный `content` — для прочих потребителей (карточка документа, сравнение — сравнение версий должно сравнивать `bodyContent`, чтобы диффы не шумели шапкой). Share — всегда собранный.

- [ ] **Step 2: Проверка**

Dev: публичная ссылка показывает документ с шапкой и реквизитами; сравнение версий не показывает шапку как изменение; карточка документа рендерит полный вид.

- [ ] **Step 3: Коммит**

```bash
git commit -am "Оформление: единая сборка слоёв для предпросмотра, шаринга и сравнения"
```

---

## Финальная проверка (после всех фаз)

- [ ] `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` — всё зелёное.
- [ ] Прогнать все 8 критериев приёмки из спеки (раздел «Критерии приёмки») на dev.
- [ ] Обновить статусы фазы 16 в CLAUDE.md на ✅.
- [ ] Прод-миграция: перед деплоем сделать бэкап БД (`pg_dump`); миграция A2 меняет балансы всех кошельков — это ожидаемо и согласовано.
