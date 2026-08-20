# Пополнение баланса токенов через кассу Т-Банка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю пополнять баланс токенов реальными деньгами через интернет-эквайринг Т-Банка (редирект на платёжную страницу, вебхук начисляет токены).

**Architecture:** Пользователь выбирает фикс-пакет → сервер создаёт `Payment` и вызывает `Init` Т-Банка → редирект на `PaymentURL` → банк шлёт вебхук со статусом `CONFIRMED` → сервер проверяет подпись, сверяет сумму и идемпотентно начисляет токены в леджер `Transaction`. Чистая логика (подпись, пакеты, классификация вебхука, идемпотентное начисление) вынесена в модули без БД/HTTP и покрыта юнит-тестами; роуты — тонкие обёртки.

**Tech Stack:** Next.js 14 App Router (route handlers), Prisma + PostgreSQL, Node `crypto` (SHA-256), Vitest.

## Global Constraints

- Интерфейс только на русском языке.
- Версии/списания/согласия — append-only; `Transaction` — леджер, строки не переписываются.
- Списания/начисления баланса — атомарны; повторный вебхук НЕ должен начислять дважды.
- В логи идут только суммы, статусы, коды ошибок, `orderId`/`paymentId` — никаких ПДн, email, содержимого чека (правило проекта № 11).
- Токены и сумму сервер берёт из своей `Payment`-записи, а не из тела запроса/вебхука.
- Цены пакетов переопределяются через ENV; конкретные рублёвые цифры — заглушки, утверждаются перед запуском.
- Тесты запускаются из `apps/web`: `pnpm --filter @dogovora/web test:run` (или `npx vitest run` в каталоге `apps/web`). Тестовые файлы — в `apps/web/tests/`, импорт из `../src/...`.
- Секрет `TBANK_PASSWORD` — только в ENV, не в репозитории, не в логах.

---

### Task 1: Конфиг пакетов токенов

**Files:**
- Create: `apps/web/src/lib/token-packages.ts`
- Test: `apps/web/tests/token-packages.test.ts`

**Interfaces:**
- Produces: `interface TokenPackage { id: string; tokens: number; priceRub: number; label: string; badge?: string }`; `TOKEN_PACKAGES: TokenPackage[]`; `getPackage(id: string): TokenPackage | undefined`; `priceKopecks(pkg: TokenPackage): number`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/token-packages.test.ts
import { describe, it, expect } from 'vitest'
import { TOKEN_PACKAGES, getPackage, priceKopecks } from '../src/lib/token-packages'

describe('token-packages', () => {
  it('пакеты уникальны, токены и цена положительные', () => {
    expect(TOKEN_PACKAGES.length).toBeGreaterThanOrEqual(3)
    const ids = TOKEN_PACKAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TOKEN_PACKAGES) {
      expect(p.tokens).toBeGreaterThan(0)
      expect(p.priceRub).toBeGreaterThan(0)
      expect(p.label).toBeTruthy()
    }
  })

  it('getPackage находит по id и возвращает undefined для неизвестного', () => {
    const first = TOKEN_PACKAGES[0]
    expect(getPackage(first.id)).toEqual(first)
    expect(getPackage('нет-такого')).toBeUndefined()
  })

  it('priceKopecks = рубли × 100 (целое)', () => {
    expect(priceKopecks({ id: 'x', tokens: 1, priceRub: 300, label: 'x' })).toBe(30000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/token-packages.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/token-packages'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/token-packages.ts
/**
 * Фикс-пакеты токенов для пополнения баланса. Сервер — единственный источник
 * соответствия «пакет → токены → цена». Цены (в рублях) переопределяются через
 * ENV TOKEN_PACKAGE_<ID>_RUB. Цифры — заглушки, утверждаются перед запуском.
 */
export interface TokenPackage {
  id: string
  tokens: number
  priceRub: number
  label: string
  badge?: string
}

function envRub(id: string, fallback: number): number {
  const v = Number(process.env[`TOKEN_PACKAGE_${id.toUpperCase()}_RUB`])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

export const TOKEN_PACKAGES: TokenPackage[] = [
  { id: 'start', tokens: 300, priceRub: envRub('start', 300), label: 'Старт' },
  { id: 'standard', tokens: 1000, priceRub: envRub('standard', 900), label: 'Стандарт', badge: 'Выгодно' },
  { id: 'pro', tokens: 3000, priceRub: envRub('pro', 2500), label: 'Про' },
  { id: 'max', tokens: 10000, priceRub: envRub('max', 7900), label: 'Максимум', badge: 'Лучшая цена' },
]

export function getPackage(id: string): TokenPackage | undefined {
  return TOKEN_PACKAGES.find((p) => p.id === id)
}

export function priceKopecks(pkg: TokenPackage): number {
  return Math.round(pkg.priceRub * 100)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/token-packages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/token-packages.ts apps/web/tests/token-packages.test.ts
git commit -m "Пакеты токенов для пополнения баланса"
```

---

### Task 2: Подпись Т-Банка (Token, SHA-256)

**Files:**
- Create: `apps/web/src/lib/tbank/signature.ts`
- Test: `apps/web/tests/tbank-signature.test.ts`

**Interfaces:**
- Produces: `signToken(params: Record<string, unknown>, password: string): string` — SHA-256 hex корневых значений + Password; `verifyToken(body: Record<string, unknown>, password: string): boolean` — сверяет `body.Token`.

- [ ] **Step 1: Write the failing test** (эталон из офиц. документации Т-Банка)

```ts
// apps/web/tests/tbank-signature.test.ts
import { describe, it, expect } from 'vitest'
import { signToken, verifyToken } from '../src/lib/tbank/signature'

describe('tbank signature', () => {
  // Эталонный пример из документации developer.tbank.ru/eacq/intro/developer/token
  it('воспроизводит эталонный хеш из документации', () => {
    const params = {
      TerminalKey: 'MerchantTerminalKey',
      Amount: 19200,
      OrderId: '00000',
      Description: 'Подарочная карта на 1000 рублей',
    }
    expect(signToken(params, '11111111111111')).toBe(
      '72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2',
    )
  })

  it('исключает вложенные объекты и массивы (Receipt, DATA) и поле Token', () => {
    const withNested = {
      TerminalKey: 'MerchantTerminalKey',
      Amount: 19200,
      OrderId: '00000',
      Description: 'Подарочная карта на 1000 рублей',
      Receipt: { Items: [{ Name: 'x' }] },
      DATA: { foo: 'bar' },
      Token: 'должен-игнорироваться',
    }
    expect(signToken(withNested, '11111111111111')).toBe(
      '72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2',
    )
  })

  it('verifyToken: true для корректной подписи, false для битой', () => {
    const body: Record<string, unknown> = { TerminalKey: 'T', OrderId: '1', Success: true, Status: 'CONFIRMED', Amount: 30000 }
    body.Token = signToken(body, 'secret')
    expect(verifyToken(body, 'secret')).toBe(true)
    expect(verifyToken({ ...body, Amount: 40000 }, 'secret')).toBe(false)
    expect(verifyToken({ ...body, Token: 'abc' }, 'secret')).toBe(false)
  })

  it('булевы значения кодируются как true/false', () => {
    // Success приходит в нотификации булевым и участвует в подписи
    const t = signToken({ Success: true, Status: 'CONFIRMED' }, 'p')
    expect(typeof t).toBe('string')
    expect(t).toHaveLength(64)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/tbank-signature.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/tbank/signature.ts
import { createHash } from 'crypto'

/** Значение примитивно (участвует в подписи)? Вложенные объекты/массивы — нет. */
function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function stringify(v: string | number | boolean): string {
  return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)
}

/**
 * Подпись запроса/нотификации Т-Банка.
 * Алгоритм: берём корневые примитивные поля (кроме Token), добавляем Password,
 * сортируем по ключу, конкатенируем ТОЛЬКО значения, SHA-256 (UTF-8), hex.
 */
export function signToken(params: Record<string, unknown>, password: string): string {
  const pairs: [string, string][] = []
  for (const [key, value] of Object.entries(params)) {
    if (key === 'Token') continue
    if (!isPrimitive(value)) continue // Receipt, DATA и прочие объекты/массивы исключаются
    pairs.push([key, stringify(value)])
  }
  pairs.push(['Password', password])
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const concatenated = pairs.map(([, v]) => v).join('')
  return createHash('sha256').update(concatenated, 'utf8').digest('hex')
}

/** Проверка подписи нотификации: сверяем пересчитанный хеш с body.Token. */
export function verifyToken(body: Record<string, unknown>, password: string): boolean {
  const provided = typeof body.Token === 'string' ? body.Token.toLowerCase() : ''
  if (!provided) return false
  return signToken(body, password) === provided
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/tbank-signature.test.ts`
Expected: PASS (4 tests). Если первый тест не даёт эталонный хеш — проверь порядок сортировки и что булевы кодируются строчными `true/false`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tbank/signature.ts apps/web/tests/tbank-signature.test.ts
git commit -m "Подпись Т-Банка: signToken/verifyToken (SHA-256) с эталонным тестом"
```

---

### Task 3: Сборка чека (Receipt, 54-ФЗ)

**Files:**
- Create: `apps/web/src/lib/tbank/receipt.ts`
- Test: `apps/web/tests/tbank-receipt.test.ts`

**Interfaces:**
- Produces: `interface ReceiptInput { email: string; label: string; amountKopecks: number }`; `buildReceipt(input: ReceiptInput): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/tbank-receipt.test.ts
import { describe, it, expect } from 'vitest'
import { buildReceipt } from '../src/lib/tbank/receipt'

describe('buildReceipt', () => {
  it('одна позиция, сумма и цена совпадают с amountKopecks', () => {
    const r = buildReceipt({ email: 'user@example.com', label: 'Пакет Старт', amountKopecks: 30000 }) as any
    expect(r.Email).toBe('user@example.com')
    expect(r.Items).toHaveLength(1)
    expect(r.Items[0].Price).toBe(30000)
    expect(r.Items[0].Amount).toBe(30000)
    expect(r.Items[0].Quantity).toBe(1)
    expect(r.Items[0].Name).toContain('Старт')
  })

  it('СНО и НДС берутся из ENV, по умолчанию usn_income / none', () => {
    const r = buildReceipt({ email: 'a@b.c', label: 'x', amountKopecks: 100 }) as any
    expect(r.Taxation).toBe('usn_income')
    expect(r.Items[0].Tax).toBe('none')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/tbank-receipt.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/tbank/receipt.ts
/**
 * Объект Receipt для облачной кассы Т-Банка (54-ФЗ). Банк по этим данным сам
 * пробивает фискальный чек. Name/Price/Amount — по одной позиции на пакет.
 */
export interface ReceiptInput {
  email: string
  label: string
  amountKopecks: number
}

export function buildReceipt(input: ReceiptInput): Record<string, unknown> {
  const taxation = process.env.TBANK_TAXATION || 'usn_income'
  const vat = process.env.TBANK_VAT || 'none'
  return {
    Email: input.email,
    Taxation: taxation,
    Items: [
      {
        Name: `Токены Догодок — ${input.label}`.slice(0, 128),
        Price: input.amountKopecks,
        Quantity: 1,
        Amount: input.amountKopecks,
        Tax: vat,
        PaymentMethod: 'full_payment',
        PaymentObject: 'service',
      },
    ],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/tbank-receipt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tbank/receipt.ts apps/web/tests/tbank-receipt.test.ts
git commit -m "Сборка чека Receipt для облачной кассы Т-Банка"
```

---

### Task 4: HTTP-клиент Т-Банка (initPayment)

**Files:**
- Create: `apps/web/src/lib/tbank/client.ts`
- Test: `apps/web/tests/tbank-client.test.ts`

**Interfaces:**
- Consumes: `signToken` (Task 2).
- Produces: `interface InitParams { orderId: string; amountKopecks: number; description: string; receipt: Record<string, unknown> }`; `interface InitResult { paymentId: string; paymentUrl: string }`; `initPayment(params: InitParams, fetchImpl?: typeof fetch): Promise<InitResult>`.

**Note:** `initPayment` принимает необязательный `fetchImpl` для теста (по умолчанию глобальный `fetch`). URL берётся из `TBANK_API_URL` (по умолчанию `https://securepay.tinkoff.ru/v2/`), URL вебхука/возврата — из `PUBLIC_BASE_URL`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/tbank-client.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { initPayment } from '../src/lib/tbank/client'

describe('initPayment', () => {
  beforeEach(() => {
    process.env.TBANK_TERMINAL_KEY = 'TestTerminal'
    process.env.TBANK_PASSWORD = 'secret'
    process.env.TBANK_API_URL = 'https://api.test/v2/'
    process.env.PUBLIC_BASE_URL = 'https://app.test'
  })

  it('шлёт подписанный Init и возвращает paymentId/paymentUrl', async () => {
    let captured: any = null
    const fakeFetch = (async (url: string, opts: any) => {
      captured = { url, body: JSON.parse(opts.body) }
      return { ok: true, json: async () => ({ Success: true, PaymentId: '123', PaymentURL: 'https://pay/123' }) }
    }) as unknown as typeof fetch

    const res = await initPayment(
      { orderId: 'ord-1', amountKopecks: 30000, description: 'Пополнение', receipt: { Email: 'a@b.c' } },
      fakeFetch,
    )
    expect(res).toEqual({ paymentId: '123', paymentUrl: 'https://pay/123' })
    expect(captured.url).toBe('https://api.test/v2/Init')
    expect(captured.body.TerminalKey).toBe('TestTerminal')
    expect(captured.body.Amount).toBe(30000)
    expect(captured.body.OrderId).toBe('ord-1')
    expect(captured.body.PayType).toBe('O')
    expect(captured.body.NotificationURL).toBe('https://app.test/api/payments/webhook')
    expect(typeof captured.body.Token).toBe('string')
    // Receipt присутствует, но в подпись не входит — проверяется в signature-тестах
    expect(captured.body.Receipt).toBeTruthy()
  })

  it('бросает ошибку, если банк вернул Success=false', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => ({ Success: false, ErrorCode: '9999', Message: 'Отказ' }),
    })) as unknown as typeof fetch
    await expect(
      initPayment({ orderId: 'o', amountKopecks: 1000, description: 'd', receipt: {} }, fakeFetch),
    ).rejects.toThrow(/9999|Отказ|Init/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/tbank-client.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/tbank/client.ts
import { signToken } from './signature'

export interface InitParams {
  orderId: string
  amountKopecks: number
  description: string
  receipt: Record<string, unknown>
}

export interface InitResult {
  paymentId: string
  paymentUrl: string
}

function apiBase(): string {
  return process.env.TBANK_API_URL || 'https://securepay.tinkoff.ru/v2/'
}

function publicBase(): string {
  return process.env.PUBLIC_BASE_URL || ''
}

/**
 * Инициирует одностадийный платёж. Подпись считается по КОРНЕВЫМ полям
 * (Receipt в подпись не входит — так требует Т-Банк). Возвращает ссылку на
 * платёжную страницу для редиректа.
 */
export async function initPayment(params: InitParams, fetchImpl: typeof fetch = fetch): Promise<InitResult> {
  const base = publicBase()
  const root: Record<string, unknown> = {
    TerminalKey: process.env.TBANK_TERMINAL_KEY || '',
    Amount: params.amountKopecks,
    OrderId: params.orderId,
    Description: params.description.slice(0, 140),
    PayType: 'O',
    NotificationURL: `${base}/api/payments/webhook`,
    SuccessURL: `${base}/balance?payment=success`,
    FailURL: `${base}/balance?payment=fail`,
  }
  const Token = signToken(root, process.env.TBANK_PASSWORD || '')
  const body = { ...root, Token, Receipt: params.receipt }

  const res = await fetchImpl(`${apiBase()}Init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as {
    Success?: boolean
    PaymentId?: string | number
    PaymentURL?: string
    ErrorCode?: string
    Message?: string
    Details?: string
  }
  if (!data.Success || !data.PaymentURL) {
    throw new Error(`Init failed: ${data.ErrorCode ?? '?'} ${data.Message ?? ''} ${data.Details ?? ''}`.trim())
  }
  return { paymentId: String(data.PaymentId), paymentUrl: data.PaymentURL }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/tbank-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tbank/client.ts apps/web/tests/tbank-client.test.ts
git commit -m "HTTP-клиент Т-Банка: initPayment с подписью и URL вебхука/возврата"
```

---

### Task 5: Модель Payment + миграция + ENV example

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (модель User — добавить relation; секция «Финансы» — добавить модель и enum)
- Modify: `.env.example` (в корне репозитория; если нет — `apps/web/.env.example`)

**Interfaces:**
- Produces: Prisma-модель `Payment` и enum `PaymentStatus`, доступные как `prisma.payment.*` и тип `PaymentStatus` из `@prisma/client`.

- [ ] **Step 1: Добавить relation в модель User**

В `apps/web/prisma/schema.prisma`, в блок `model User { … }` (список relations, рядом с `wallet Wallet?`) добавить строку:

```prisma
  payments           Payment[]
```

- [ ] **Step 2: Добавить модель и enum в секцию «Финансы»**

В `apps/web/prisma/schema.prisma`, после модели `Wallet` (или рядом с `Transaction`) добавить:

```prisma
// Платёж-пополнение через кассу Т-Банка. Статус изменяемый (жизненный цикл
// платежа), но начисление токенов идёт в append-only леджер Transaction.
// Двойная идемпотентность: orderId (наш) и bankPaymentId (банка) уникальны,
// creditedAt гарантирует ровно одно начисление даже при повторном вебхуке.
model Payment {
  id                  String        @id @default(cuid())
  userId              String
  orderId             String        @unique
  bankPaymentId       String?       @unique
  packageId           String
  tokens              Int
  amount              Int           // копейки
  status              PaymentStatus @default(NEW)
  errorCode           String?
  creditedAt          DateTime?
  creditTransactionId String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("payments")
}

enum PaymentStatus {
  NEW
  AUTHORIZED
  CONFIRMED
  REJECTED
  REFUNDED
  CANCELED
}
```

- [ ] **Step 3: Создать миграцию и сгенерировать клиент**

Run:
```bash
cd apps/web && npx prisma migrate dev --name add_payments
```
Expected: создан каталог `prisma/migrations/<timestamp>_add_payments/` с `CREATE TABLE "payments"` и `CREATE TYPE "PaymentStatus"`; Prisma Client перегенерирован. (Требуется поднятая БД из docker-compose.)

- [ ] **Step 4: Добавить переменные в `.env.example`**

Дописать в `.env.example` блок (значения — плейсхолдеры):

```bash
# Интернет-эквайринг Т-Банка (пополнение баланса токенов)
TBANK_TERMINAL_KEY=
TBANK_PASSWORD=
TBANK_API_URL=https://securepay.tinkoff.ru/v2/
PUBLIC_BASE_URL=https://app.dogodoc.ru
TBANK_TAXATION=usn_income
TBANK_VAT=none
# Необязательно — переопределение цен пакетов в рублях:
# TOKEN_PACKAGE_START_RUB=300
# TOKEN_PACKAGE_STANDARD_RUB=900
# TOKEN_PACKAGE_PRO_RUB=2500
# TOKEN_PACKAGE_MAX_RUB=7900
```

- [ ] **Step 5: Проверить типизацию**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS (нет ошибок; тип `PaymentStatus` и `prisma.payment` доступны).

- [ ] **Step 6: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations .env.example
git commit -m "Модель Payment + миграция add_payments + ENV эквайринга"
```

---

### Task 6: Идемпотентное начисление за платёж

**Files:**
- Create: `apps/web/src/lib/payments.ts`
- Test: `apps/web/tests/payment-credit.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/db`), тип `PaymentStatus`.
- Produces: `creditForPayment(paymentId: string, db?: typeof prisma): Promise<'credited' | 'already'>`.

**Note:** Начисление делается инлайн внутри одной транзакции с guard `payment.creditedAt` — это и атомарность, и защита от двойного начисления. Отдельный `creditTokens`-хелпер не выделяем (YAGNI: единственный источник начисления — платёж). `db` инжектируется для теста.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/payment-credit.test.ts
import { describe, it, expect, vi } from 'vitest'
import { creditForPayment } from '../src/lib/payments'

function makeFakeDb(payment: { id: string; userId: string; tokens: number }) {
  let creditedAt: Date | null = null
  const tx = {
    payment: {
      updateMany: vi.fn(async ({ data }: any) => {
        if (creditedAt) return { count: 0 }
        creditedAt = data.creditedAt
        return { count: 1 }
      }),
      findUnique: vi.fn(async () => ({ ...payment, creditedAt })),
      update: vi.fn(async () => ({})),
    },
    wallet: {
      upsert: vi.fn(async () => ({ id: 'w1' })),
      update: vi.fn(async () => ({})),
    },
    transaction: { create: vi.fn(async () => ({ id: 't1' })) },
  }
  const db = { $transaction: async (fn: any) => fn(tx) } as any
  return { db, tx }
}

describe('creditForPayment', () => {
  it('первое начисление увеличивает баланс и пишет CREDIT-транзакцию', async () => {
    const { db, tx } = makeFakeDb({ id: 'p1', userId: 'u1', tokens: 1000 })
    const r = await creditForPayment('p1', db)
    expect(r).toBe('credited')
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { increment: 1000 } } }),
    )
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CREDIT', currency: 'TOKEN', amount: 1000 }) }),
    )
  })

  it('повторный вебхук не начисляет второй раз', async () => {
    const { db, tx } = makeFakeDb({ id: 'p1', userId: 'u1', tokens: 1000 })
    await creditForPayment('p1', db)
    tx.wallet.update.mockClear()
    tx.transaction.create.mockClear()
    const r = await creditForPayment('p1', db)
    expect(r).toBe('already')
    expect(tx.wallet.update).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/payment-credit.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/payments.ts
import { prisma } from '@/lib/db'

/**
 * Идемпотентно начисляет токены за подтверждённый платёж.
 * Guard: updateMany where creditedAt IS NULL — ровно одна транзакция «выигрывает»
 * право начислить; повторные вебхуки видят count=0 и выходят. Инкремент баланса
 * атомарен на уровне SQL, отдельный FOR UPDATE не нужен.
 */
export async function creditForPayment(
  paymentId: string,
  db: typeof prisma = prisma,
): Promise<'credited' | 'already'> {
  return db.$transaction(async (tx) => {
    const marked = await tx.payment.updateMany({
      where: { id: paymentId, creditedAt: null },
      data: { creditedAt: new Date(), status: 'CONFIRMED' },
    })
    if (marked.count === 0) return 'already'

    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment) return 'already'

    const wallet = await tx.wallet.upsert({
      where: { userId: payment.userId },
      create: { userId: payment.userId, balance: 0 },
      update: {},
    })
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: payment.tokens } },
    })
    const trx = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount: payment.tokens,
        currency: 'TOKEN',
        description: `Пополнение баланса: ${payment.tokens} токенов`,
      },
    })
    await tx.payment.update({
      where: { id: paymentId },
      data: { creditTransactionId: trx.id },
    })
    return 'credited'
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/payment-credit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/payments.ts apps/web/tests/payment-credit.test.ts
git commit -m "Идемпотентное начисление токенов за платёж (creditForPayment)"
```

---

### Task 7: Классификация вебхука

**Files:**
- Modify: `apps/web/src/lib/payments.ts` (добавить classifyNotification + типы)
- Test: `apps/web/tests/payment-notification.test.ts`

**Interfaces:**
- Consumes: `verifyToken` (Task 2), `PaymentStatus`.
- Produces:
  - `interface NotificationBody { OrderId?: string; Status?: string; Amount?: number; Token?: string; [k: string]: unknown }`
  - `type NotificationOutcome = { action: 'reject'; reason: string } | { action: 'ignore'; reason: string } | { action: 'credit'; paymentId: string } | { action: 'status'; paymentId: string; status: PaymentStatus }`
  - `classifyNotification(body: NotificationBody, deps: { password: string; loadPayment: (orderId: string) => Promise<{ id: string; amount: number } | null> }): Promise<NotificationOutcome>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/payment-notification.test.ts
import { describe, it, expect } from 'vitest'
import { classifyNotification } from '../src/lib/payments'
import { signToken } from '../src/lib/tbank/signature'

const PW = 'secret'
function signed(body: Record<string, unknown>) {
  return { ...body, Token: signToken(body, PW) }
}
const loadPayment = async (orderId: string) =>
  orderId === 'ord-1' ? { id: 'p1', amount: 30000 } : null

describe('classifyNotification', () => {
  it('битая подпись → reject', async () => {
    const out = await classifyNotification(
      { OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000, Token: 'плохой' },
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'reject', reason: 'bad_signature' })
  })

  it('неизвестный заказ → ignore', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'нет', Status: 'CONFIRMED', Amount: 30000 }),
      { password: PW, loadPayment },
    )
    expect(out.action).toBe('ignore')
  })

  it('несовпадение суммы → ignore', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 99999 }),
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'ignore', reason: 'amount_mismatch' })
  })

  it('CONFIRMED с верной суммой → credit', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'ord-1', Status: 'CONFIRMED', Amount: 30000 }),
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'credit', paymentId: 'p1' })
  })

  it('REJECTED → status REJECTED', async () => {
    const out = await classifyNotification(
      signed({ OrderId: 'ord-1', Status: 'REJECTED', Amount: 30000 }),
      { password: PW, loadPayment },
    )
    expect(out).toEqual({ action: 'status', paymentId: 'p1', status: 'REJECTED' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/payment-notification.test.ts`
Expected: FAIL — `classifyNotification` не экспортирован.

- [ ] **Step 3: Write minimal implementation** (дописать в `apps/web/src/lib/payments.ts`)

```ts
// добавить импорт вверху файла:
import { verifyToken } from '@/lib/tbank/signature'
import type { PaymentStatus } from '@prisma/client'

// добавить в конец файла:
export interface NotificationBody {
  OrderId?: string
  Status?: string
  Amount?: number
  Token?: string
  [k: string]: unknown
}

export type NotificationOutcome =
  | { action: 'reject'; reason: string }
  | { action: 'ignore'; reason: string }
  | { action: 'credit'; paymentId: string }
  | { action: 'status'; paymentId: string; status: PaymentStatus }

/**
 * Чистая классификация вебхука: подпись → заказ → сумма → статус.
 * Токены/сумму берём из нашей записи (deps.loadPayment), не из тела.
 */
export async function classifyNotification(
  body: NotificationBody,
  deps: { password: string; loadPayment: (orderId: string) => Promise<{ id: string; amount: number } | null> },
): Promise<NotificationOutcome> {
  if (!verifyToken(body, deps.password)) return { action: 'reject', reason: 'bad_signature' }

  const orderId = String(body.OrderId ?? '')
  if (!orderId) return { action: 'ignore', reason: 'no_order' }

  const payment = await deps.loadPayment(orderId)
  if (!payment) return { action: 'ignore', reason: 'unknown_order' }

  if (Number(body.Amount) !== payment.amount) return { action: 'ignore', reason: 'amount_mismatch' }

  const status = String(body.Status ?? '')
  if (status === 'CONFIRMED') return { action: 'credit', paymentId: payment.id }
  if (status === 'REJECTED') return { action: 'status', paymentId: payment.id, status: 'REJECTED' }
  if (status === 'CANCELED') return { action: 'status', paymentId: payment.id, status: 'CANCELED' }
  if (status === 'AUTHORIZED') return { action: 'status', paymentId: payment.id, status: 'AUTHORIZED' }
  return { action: 'ignore', reason: 'unhandled_status' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/payment-notification.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/payments.ts apps/web/tests/payment-notification.test.ts
git commit -m "Классификация вебхука Т-Банка (подпись/заказ/сумма/статус)"
```

---

### Task 8: Роут создания платежа

**Files:**
- Create: `apps/web/src/app/api/payments/create/route.ts`

**Interfaces:**
- Consumes: `getUserId`, `rateLimit`, `getClientIp`, `getPackage`, `priceKopecks`, `buildReceipt`, `initPayment`, `prisma`, `logger`.
- Produces: `POST /api/payments/create` — тело `{ packageId }` → ответ `{ paymentUrl, paymentId }`.

- [ ] **Step 1: Написать роут**

```ts
// apps/web/src/app/api/payments/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getUserId } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getPackage, priceKopecks } from '@/lib/token-packages'
import { buildReceipt } from '@/lib/tbank/receipt'
import { initPayment } from '@/lib/tbank/client'

// POST /api/payments/create — создаёт платёж и возвращает ссылку на оплату.
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`pay-create:${userId}`, 10, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Слишком часто, попробуйте позже.' }, { status: 429 })

  let packageId = ''
  try {
    packageId = String((await req.json())?.packageId ?? '')
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const pkg = getPackage(packageId)
  if (!pkg) return NextResponse.json({ error: 'Неизвестный пакет' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderId = `pay_${randomUUID()}`
  const amount = priceKopecks(pkg)

  const payment = await prisma.payment.create({
    data: { userId, orderId, packageId: pkg.id, tokens: pkg.tokens, amount, status: 'NEW' },
  })

  try {
    const init = await initPayment({
      orderId,
      amountKopecks: amount,
      description: `Пополнение баланса — ${pkg.label}`,
      receipt: buildReceipt({ email: user.email, label: pkg.label, amountKopecks: amount }),
    })
    await prisma.payment.update({ where: { id: payment.id }, data: { bankPaymentId: init.paymentId } })
    logger.info({ event: 'payment.created', user_id: userId, order_id: orderId, amount, tokens: pkg.tokens })
    return NextResponse.json({ paymentUrl: init.paymentUrl, paymentId: payment.id })
  } catch (e) {
    logger.error({ event: 'payment.init_failed', user_id: userId, order_id: orderId, error: String(e) })
    return NextResponse.json({ error: 'Не удалось создать платёж. Попробуйте позже.' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Проверить типизацию**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/payments/create/route.ts
git commit -m "Роут POST /api/payments/create: создание платежа и ссылка на оплату"
```

---

### Task 9: Роут вебхука

**Files:**
- Create: `apps/web/src/app/api/payments/webhook/route.ts`

**Interfaces:**
- Consumes: `rateLimit`, `getClientIp`, `classifyNotification`, `creditForPayment`, `prisma`, `logger`.
- Produces: `POST /api/payments/webhook` — принимает нотификацию Т-Банка, отвечает телом `OK` (200) при успешной обработке или `403` при битой подписи.

**Note:** Ответ ровно `OK` заглавными, без HTML (требование Т-Банка). При невалидной подписи — 403 (не начисляем). Неизвестный заказ/несовпадение суммы — логируем, но отвечаем `OK`, чтобы банк не молотил переотправками (начисления при этом нет).

- [ ] **Step 1: Написать роут**

```ts
// apps/web/src/app/api/payments/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { classifyNotification, creditForPayment, type NotificationBody } from '@/lib/payments'

const OK = () => new NextResponse('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })

// POST /api/payments/webhook — нотификация Т-Банка о статусе платежа.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = await rateLimit(`pay-webhook:${ip}`, 120, 60_000)
  if (!rl.allowed) return new NextResponse('OK', { status: 200 })

  let body: NotificationBody
  try {
    body = (await req.json()) as NotificationBody
  } catch {
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }

  const password = process.env.TBANK_PASSWORD || ''
  const outcome = await classifyNotification(body, {
    password,
    loadPayment: async (orderId) => {
      const p = await prisma.payment.findUnique({ where: { orderId }, select: { id: true, amount: true } })
      return p ? { id: p.id, amount: p.amount } : null
    },
  })

  switch (outcome.action) {
    case 'reject':
      logger.error({ event: 'payment.webhook_bad_signature', order_id: String(body.OrderId ?? '') })
      return new NextResponse('FORBIDDEN', { status: 403 })
    case 'ignore':
      logger.info({ event: 'payment.webhook_ignored', reason: outcome.reason, order_id: String(body.OrderId ?? '') })
      return OK()
    case 'status':
      await prisma.payment.update({ where: { id: outcome.paymentId }, data: { status: outcome.status } })
      logger.info({ event: 'payment.webhook_status', payment_id: outcome.paymentId, status: outcome.status })
      return OK()
    case 'credit': {
      const res = await creditForPayment(outcome.paymentId)
      logger.info({ event: 'payment.webhook_credit', payment_id: outcome.paymentId, result: res })
      return OK()
    }
  }
}
```

- [ ] **Step 2: Проверить типизацию**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/payments/webhook/route.ts
git commit -m "Роут POST /api/payments/webhook: проверка подписи и начисление токенов"
```

---

### Task 10: Роут статуса платежа

**Files:**
- Create: `apps/web/src/app/api/payments/[id]/status/route.ts`

**Interfaces:**
- Consumes: `getUserId`, `prisma`.
- Produces: `GET /api/payments/:id/status` → `{ status, credited, tokens }` (только для владельца платежа).

- [ ] **Step 1: Написать роут**

```ts
// apps/web/src/app/api/payments/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

// GET /api/payments/:id/status — статус платежа для страницы возврата (poll).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payment = await prisma.payment.findFirst({
    where: { id: params.id, userId },
    select: { status: true, creditedAt: true, tokens: true },
  })
  if (!payment) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })

  return NextResponse.json({
    status: payment.status,
    credited: payment.creditedAt !== null,
    tokens: payment.tokens,
  })
}
```

- [ ] **Step 2: Проверить типизацию**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/payments/\[id\]/status/route.ts
git commit -m "Роут GET /api/payments/:id/status для страницы возврата"
```

---

### Task 11: UI пополнения на экране баланса

**Files:**
- Modify: `apps/web/src/app/(app)/balance/page.tsx` (заменить карточку-заглушку «Пополнение» на пакеты; обработать `?payment=success|fail`)

**Interfaces:**
- Consumes: `GET /api/wallet`, `POST /api/payments/create`, `GET /api/payments/:id/status`.

- [ ] **Step 1: Заменить карточку «Пополнение» на пакеты**

В `apps/web/src/app/(app)/balance/page.tsx` заменить блок `{/* Пояснение: пополнение появится позже */}` (Card со словами «Пополнение появится вместе с подключением платёжного шлюза») на карточку с пакетами. Добавить типы, загрузку пакетов и обработчик покупки. Вставить в начало компонента (после существующих `useState`):

```tsx
  const [packages, setPackages] = useState<{ id: string; tokens: number; priceRub: number; label: string; badge?: string }[]>([])
  const [buying, setBuying] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
```

Расширить `loadData`, чтобы забрать пакеты (эндпоинт добавляется в шаге 2):

```tsx
      const pkgRes = await fetch('/api/payments/packages')
      if (pkgRes.ok) setPackages((await pkgRes.json()).packages ?? [])
```

Добавить обработчик и разбор query-параметра возврата (после `useEffect(() => { loadData() }, [])`):

```tsx
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const p = q.get('payment')
    if (p === 'success') setNotice('Оплата принята. Токены зачислятся в течение минуты — баланс обновится.')
    if (p === 'fail') setNotice('Оплата не завершена. Попробуйте ещё раз.')
    if (p) {
      // Дать вебхуку время начислить и подтянуть баланс
      const t = setInterval(loadData, 3000)
      const stop = setTimeout(() => clearInterval(t), 30000)
      return () => { clearInterval(t); clearTimeout(stop) }
    }
  }, [])

  async function buy(packageId: string) {
    setBuying(packageId)
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
      })
      const data = await res.json()
      if (res.ok && data.paymentUrl) {
        window.location.href = data.paymentUrl
      } else {
        setNotice(data.error || 'Не удалось начать оплату.')
        setBuying(null)
      }
    } catch {
      setNotice('Сеть недоступна. Попробуйте позже.')
      setBuying(null)
    }
  }
```

Заменить карточку-заглушку «Пополнение» на:

```tsx
          {/* Пополнение — фикс-пакеты */}
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Пополнение</p>
            {notice && (
              <p className="text-[13px] text-[var(--ink-2)] mb-[12px] leading-[1.6]">{notice}</p>
            )}
            <div className="grid grid-cols-2 gap-[10px]">
              {packages.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => buy(pkg.id)}
                  disabled={buying !== null}
                  className="text-left rounded-[10px] p-[14px] transition-colors disabled:opacity-60"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
                >
                  <div className="flex items-center justify-between mb-[6px]">
                    <span className="text-[13px] font-medium text-[var(--ink)]">{pkg.label}</span>
                    {pkg.badge && (
                      <span className="text-[10px] px-[6px] py-[2px] rounded-full" style={{ background: 'oklch(0.95 0.03 260)', color: 'var(--accent)' }}>{pkg.badge}</span>
                    )}
                  </div>
                  <p className="text-[18px]" style={{ fontFamily: 'var(--font-mono)' }}>{pkg.tokens.toLocaleString('ru')}<span className="text-[12px] text-[var(--ink-4)]"> токенов</span></p>
                  <p className="text-[13px] text-[var(--ink-3)] mt-[2px]" style={{ fontFamily: 'var(--font-mono)' }}>{pkg.priceRub.toLocaleString('ru')} ₽</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--ink-4)] mt-[12px] leading-[1.5]">
              Оплата картой, СБП или T-Pay через защищённую страницу Т-Банка. Купленные токены не возвращаются.
            </p>
          </Card>
```

- [ ] **Step 2: Добавить публичный эндпоинт списка пакетов**

Создать `apps/web/src/app/api/payments/packages/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { TOKEN_PACKAGES } from '@/lib/token-packages'

// GET /api/payments/packages — витрина пакетов для UI (без секретов).
export async function GET() {
  return NextResponse.json({
    packages: TOKEN_PACKAGES.map((p) => ({ id: p.id, tokens: p.tokens, priceRub: p.priceRub, label: p.label, badge: p.badge })),
  })
}
```

- [ ] **Step 3: Проверить сборку и типизацию**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/balance/page.tsx" apps/web/src/app/api/payments/packages/route.ts
git commit -m "UI пополнения: фикс-пакеты на экране баланса + витрина пакетов"
```

---

### Task 12: Удалить заглушку topup, финальная проверка, чек-лист для банка

**Files:**
- Modify: `apps/web/src/app/api/wallet/topup/route.ts` (удалить или оставить 410 — см. ниже)
- Create: `docs/superpowers/plans/2026-08-20-tbank-owner-checklist.md`

- [ ] **Step 1: Обновить старый роут topup**

Заменить тело `apps/web/src/app/api/wallet/topup/route.ts` на редирект-подсказку (старый клиент мог его дёргать):

```ts
import { NextResponse } from 'next/server'

// POST /api/wallet/topup — устарел. Пополнение теперь через /api/payments/create
// (интернет-эквайринг Т-Банка). Оставлен для обратной совместимости старого фронта.
export async function POST() {
  return NextResponse.json(
    { error: 'Пополнение переехало. Обновите страницу баланса.', code: 'MOVED' },
    { status: 410 },
  )
}
```

- [ ] **Step 2: Прогнать все тесты**

Run: `cd apps/web && npx vitest run`
Expected: PASS — все существующие тесты + новые (token-packages, tbank-signature, tbank-receipt, tbank-client, payment-credit, payment-notification).

- [ ] **Step 3: Типизация и линт**

Run: `cd apps/web && npx tsc --noEmit && npx eslint src/lib/tbank src/lib/payments.ts src/lib/token-packages.ts src/app/api/payments`
Expected: PASS (нет ошибок).

- [ ] **Step 4: Написать чек-лист для банка**

Создать `docs/superpowers/plans/2026-08-20-tbank-owner-checklist.md`:

```markdown
# Что владелец делает в Т-Банке (перед боевым запуском)

1. Подключить интернет-эквайринг в Т-Бизнесе (счёт ИП уже есть).
2. Подключить облачную кассу («Чеки») — для фискализации по 54-ФЗ.
3. Получить реквизиты ТЕСТОВОГО терминала: `TerminalKey` + `Password` → в `.env` как
   `TBANK_TERMINAL_KEY` / `TBANK_PASSWORD`, `TBANK_API_URL` оставить боевым (терминал
   тестовый определяется ключом).
4. В настройках терминала указать `NotificationURL`: `https://<домен>/api/payments/webhook`.
5. Подтвердить систему налогообложения (СНО) → `TBANK_TAXATION` (напр. `usn_income`) и
   ставку НДС → `TBANK_VAT` (для ИП без НДС — `none`).
6. Включить одностадийную оплату (PayType O) и способы: карты, СБП, T-Pay.
7. Прогнать тестовую оплату (тестовые карты Т-Банка) → проверить, что вебхук пришёл и
   баланс пополнился.
8. Получить БОЕВОЙ терминал, заменить ключи в проде, повторить одну реальную оплату.
9. Утвердить финальные цены пакетов (`TOKEN_PACKAGE_*_RUB`) с учётом комиссии (~2,5–3%,
   НДС 22% на комиссию по картам с 2026; СБП дешевле).
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/wallet/topup/route.ts docs/superpowers/plans/2026-08-20-tbank-owner-checklist.md
git commit -m "Деактивация старого topup + чек-лист подключения Т-Банка"
```

---

## Self-Review

**Spec coverage:**
- Поток оплаты (редирект) → Tasks 4, 8, 11. ✓
- Модель Payment + двойная идемпотентность → Task 5 (модель), Task 6 (creditedAt guard). ✓
- Начисление токенов (CREDIT в леджер) → Task 6. ✓
- Пакеты (конфиг, сервер — источник истины) → Task 1, витрина Task 11. ✓
- Секреты/ENV → Task 5 (.env.example), используются в Tasks 4, 8, 9. ✓
- Receipt (54-ФЗ) → Task 3, применён в Task 8. ✓
- Безопасность: подпись обе стороны (Tasks 2, 9), сверка суммы (Task 7), rate-limit (Tasks 8, 9), логи без ПДн (Tasks 8, 9). ✓
- UI (пакеты, возврат) → Task 11. ✓
- Тесты (эталонный хеш, идемпотентность, классификация) → Tasks 2, 6, 7. ✓
- Границы (нет виджета/самовозврата/рекуррента) → не реализуем, старый topup деактивирован (Task 12). ✓
- Что делать в банке → Task 12 (чек-лист). ✓

**Placeholder scan:** цены пакетов — сознательные заглушки (согласовано); прочих TBD/TODO нет. ✓

**Type consistency:** `signToken/verifyToken` (Task 2) едины во всех потребителях; `creditForPayment` и `classifyNotification` из одного модуля `lib/payments.ts` (Tasks 6, 7); `NotificationOutcome.status` — тип `PaymentStatus` из enum Task 5; `getPackage/priceKopecks` (Task 1) используются в Tasks 8, 11. ✓
