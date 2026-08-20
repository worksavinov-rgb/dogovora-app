# Пополнение баланса токенов через кассу Т-Банка

> Дата: 2026-08-20
> Статус: согласовано владельцем, готово к плану реализации
> Связано: `2026-08-19-token-prepaid-design.md` (предоплатная монетизация токенами)

## Цель

Дать пользователю возможность **пополнять баланс токенов за реальные деньги** через
интернет-эквайринг Т-Банка. Сейчас `POST /api/wallet/topup` отключён (отдаёт 503 «до
платёжного шлюза») — этот дизайн заменяет заглушку рабочим платёжным потоком.

Пользователь выбирает **фиксированный пакет** токенов → оплачивает на стороне Т-Банка
(карта / СБП / T-Pay) → после подтверждения банком токены атомарно зачисляются в кошелёк.

## Ключевые решения (согласованы с владельцем)

1. **Фискализация — облачная касса Т-Банка.** В платёж передаём объект `Receipt`, банк
   сам пробивает фискальный чек (54-ФЗ). Отдельная онлайн-касса/ОФД не подключается.
2. **Только фикс-пакеты.** 4–5 кнопок с готовыми номиналами. Ввода произвольной суммы нет.
3. **Способ интеграции — редирект на платёжную страницу Т-Банка (hosted payment page).**
   Мы не касаемся данных карт → PCI DSS на нас не падает. Все способы оплаты из коробки.
   Встроенный виджет и своя форма — отклонены (виджет возможен позже как полировка).
4. **Возвраты — нет.** Купленные токены невозвратные (расходуемые цифровые кредиты),
   это фиксируется в оферте. Статус `REFUNDED` и ручной возврат через поддержку оставляем
   на исключительные случаи, кнопки самовозврата в UI нет.
5. **Секреты терминала — в ENV** (`TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`), как `JWT_SECRET`
   и доступ к БД. Один операционный секрет мерчанта, рантайм-админка ему не нужна.
6. **Цены/номиналы — заглушки** (300/1000/3000/10000 токенов). Структуру принимаем сейчас,
   точные значения и рублёвые цены подставим в конфиг перед запуском.

## Существующая инфраструктура (точки интеграции)

Из разведки по коду — что переиспользуем, чего не хватает:

**Есть:**
- `Wallet.balance Decimal(10,2)` (один на пользователя) + леджер `Transaction`
  (`type CREDIT|DEBIT`, `currency TOKEN|RUB`, `amount`, `description`, `createdAt`).
- Атомарное списание `chargeTokens` (`apps/web/src/lib/token-charges.ts`): `wallet.upsert`
  → `$transaction` → `SELECT balance … FOR UPDATE` → проверки идемпотентности → `decrement`
  → `Transaction{DEBIT}` → `TokenCharge`.
- Возврат `refundChargeById`: race-guard `updateMany where refundedAt IS NULL` → `increment`
  → `Transaction{CREDIT}`. **Это образец для начисления при пополнении.**
- Приветственный бонус в `api/auth/register/route.ts`: `wallet.create{balance}` +
  `Transaction{CREDIT}` внутри `$transaction`.
- Auth-хелпер `getUserId(req)` (`apps/web/src/lib/api-auth.ts`) для приватных роутов.
- Публичный бессессионный роут-прецедент: `GET /api/share/[token]` — авторизация по
  непрозрачному токену в БД + `rateLimit(\`share:${ip}\`, …)` из `@/lib/rate-limit`.
- Шифрование секретов AES-256-GCM: `apps/web/src/lib/ai/config/encryption.ts` (на будущее,
  если решим хранить секрет в БД; на MVP — ENV).
- Экран баланса (`04-balance.png`) и история операций уже отображают CREDIT/DEBIT.

**Нет (закладываем в этот дизайн):**
- Функции начисления `creditTokens` (сейчас инкремент баланса живёт только внутри
  `refundChargeById` и роута регистрации).
- Модели платежа с уникальным ключом для идемпотентности вебхука.
- Проверки подписи (Token/SHA-256) и любого вебхук-приёмника.

## API Т-Банка (сводка изученного)

- **Init:** `POST https://securepay.tinkoff.ru/v2/Init`. Обязательно: `TerminalKey`,
  `Amount` (в копейках; минимум для СБП — 1000 коп.), `OrderId` (≤50 симв., уникальный),
  `Token`. Важные: `Description`, `Receipt`, `NotificationURL`, `SuccessURL`, `FailURL`,
  `PayType` (`O` — одностадийная), `DATA`. Ответ: `PaymentId`, `PaymentURL`.
- **Подпись `Token`:** собрать пары ключ-значение только **корневых** полей (вложенные
  `Receipt`, `DATA` исключаются) → добавить `{Password: …}` → отсортировать по ключу →
  сконкатенировать **только значения** → SHA-256 (UTF-8). Эталон из документации:
  строка `19200Подарочная карта на 1000 рублей0000011111111111111MerchantTerminalKey`
  → `72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2`.
- **Вебхук (нотификация):** POST на `NotificationURL`, поля `TerminalKey`, `OrderId`,
  `PaymentId`, `Success`, `Status`, `Amount`, `ErrorCode`, `Token` и др. Статусы
  `AUTHORIZED`, `CONFIRMED`, `REJECTED`, `REFUNDED`. Проверка Token — тем же алгоритмом.
  **Ответ сервера: HTTP 200, тело ровно `OK`** (заглавными, без HTML). Переотправка: раз
  в час 24 часа, затем раз в сутки месяц.
- **Одностадийная оплата** (`PayType=O`): средства captured сразу на `CONFIRMED` —
  подходит для цифрового товара.
- Есть тестовый терминал для отладки до боевого подключения.

## Архитектура

### Поток данных

```
Экран баланса ──(packageId)──▶ POST /api/payments/create
                                      │  создаёт Payment(NEW, orderId), Init→Т-Банк
                                      ▼
                             { paymentUrl } ──▶ фронт редиректит на PaymentURL
                                                      │ оплата (карта/СБП/T-Pay)
        Т-Банк ──POST──▶ /api/payments/webhook ◀──────┘
                              │ verify Token; Amount==Payment.amount
                              │ idempotent: Payment.creditedAt guard
                              │ creditTokens() → balance += tokens, Transaction{CREDIT}
                              ▼
                          ответ "OK"
   пользователь ◀─ SuccessURL /balance?payment=success ─ опрос GET /api/payments/:id/status
```

### Компоненты (единицы с одной ответственностью)

1. **`lib/tbank/signature.ts`** — формирование и проверка `Token` (SHA-256). Чистые
   функции `signRequest(params, password)` и `verifyNotification(body, password)`.
   Тестируется изолированно против эталона из документации.
2. **`lib/tbank/client.ts`** — HTTP-клиент: `initPayment(params)` → `{ paymentId, paymentUrl }`.
   Знает `TBANK_API_URL`, подставляет `TerminalKey`, зовёт `signature.ts`. Никакой БД.
3. **`lib/tbank/receipt.ts`** — сборка объекта `Receipt` из пакета + email пользователя +
   `TBANK_TAXATION`/`TBANK_VAT`.
4. **`lib/token-packages.ts`** — типизированный список пакетов `{ id, tokens, priceRub,
   priceKopecks, label, badge? }` с ENV-переопределением цен. Единственный источник
   соответствия «пакет → токены → сумма». Функция `getPackage(id)`.
5. **`lib/token-charges.ts` (дополняем)** — `creditTokens({ userId, tokens, description })`:
   лок кошелька → `increment` → `Transaction{CREDIT, TOKEN}`. По образцу `refundChargeById`.
6. **`api/payments/create/route.ts`** — приватный (`getUserId`), rate-limit по пользователю.
   Валидирует `packageId`, создаёт `Payment`, зовёт `client.initPayment`, сохраняет
   `bankPaymentId`, возвращает `{ paymentUrl }`.
7. **`api/payments/webhook/route.ts`** — публичный, бессессионный. Проверяет подпись,
   сверяет `Amount`, идемпотентно начисляет, отвечает `OK`. Rate-limit по IP.
8. **`api/payments/[id]/status/route.ts`** — приватный, для страницы возврата: отдаёт
   статус платежа и признак «токены зачислены».
9. **UI** — карточки пакетов на экране баланса + обработка `?payment=success|fail`.

### Модель данных (Prisma)

Новая таблица `Payment` (`@@map("payments")`). Статус изменяемый (у платежа естественный
жизненный цикл), но денежное начисление идёт в append-only леджер `Transaction`.

```
model Payment {
  id                  String        @id @default(cuid())
  userId              String
  orderId             String        @unique          // наш идентификатор, уходит в Init.OrderId
  bankPaymentId       String?       @unique          // PaymentId от Т-Банка
  packageId           String                          // из token-packages
  tokens              Int                              // сколько начислить (снимок из пакета)
  amount              Int                              // копейки (снимок из пакета)
  status              PaymentStatus @default(NEW)
  errorCode           String?
  creditedAt          DateTime?                        // гвардия «начислено один раз»
  creditTransactionId String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("payments")
}

enum PaymentStatus { NEW  AUTHORIZED  CONFIRMED  REJECTED  REFUNDED  CANCELED }
```

Миграция добавляет таблицу и enum; существующие данные не трогает.

### Идемпотентное начисление (ядро корректности)

В обработчике вебхука на статусе `CONFIRMED`, внутри одной `$transaction`:

1. `updateMany({ where: { id: payment.id, creditedAt: null }, data: { creditedAt: now, status: CONFIRMED } })`.
2. Если `count === 0` → уже начисляли (повторный вебхук) → ничего не делаем, отвечаем `OK`.
3. Если `count === 1` → `creditTokens` (лок кошелька, `increment`, `Transaction{CREDIT}`),
   сохраняем `creditTransactionId`.

Двойные ключи (`orderId`, `bankPaymentId` уникальны) + `creditedAt`-guard гарантируют, что
повторные нотификации и переотправки Т-Банка не приводят к двойному начислению.

## Обработка ошибок

- **Init вернул ошибку/не 200** → `Payment` остаётся `NEW`, роут отдаёт 502 с человеческим
  сообщением, токены не трогаются.
- **Вебхук, невалидная подпись** → логируем security-событие (без ПДн), не начисляем,
  отвечаем не-`OK` (403). Начисление возможно только при валидной подписи.
- **Вебхук, `Amount` ≠ `Payment.amount`** → расхождение, не начисляем, логируем, алерт.
- **Вебхук `REJECTED/CANCELED`** → обновляем статус, ничего не начисляем, отвечаем `OK`.
- **Пользователь не вернулся, но оплата прошла** → вебхук всё равно зачислит; страница
  баланса при следующем заходе покажет актуальный баланс. Вебхук — источник истины.
- **Redis/rate-limit недоступен** → деградируем как в существующем `rateLimit` (не блокируем
  критичный вебхук из-за инфраструктуры, но логируем).

## Безопасность

- Подпись на каждый исходящий запрос и проверка на каждом входящем вебхуке.
- Токены/сумма берутся **из `Payment` по `orderId`**, а не из тела вебхука; тело лишь
  сверяется. Клиент шлёт только `packageId`, суммы вычисляет сервер.
- Rate-limit: `create` — по `userId`, `webhook` — по IP.
- Секрет `TBANK_PASSWORD` только в ENV, не в репозитории, не в логах.
- Логи: только суммы, статусы, коды ошибок, `orderId`/`paymentId`. Никаких ПДн, email,
  содержимого чека (правило проекта № 11).

## Конфигурация (ENV)

| Переменная | Назначение |
|---|---|
| `TBANK_TERMINAL_KEY` | Идентификатор терминала |
| `TBANK_PASSWORD` | Пароль терминала (секрет подписи) |
| `TBANK_API_URL` | База API (по умолчанию `https://securepay.tinkoff.ru/v2/`) |
| `PUBLIC_BASE_URL` | Для сборки `NotificationURL`/`SuccessURL`/`FailURL` |
| `TBANK_TAXATION` | СНО для чека (напр. `usn_income`) |
| `TBANK_VAT` | Ставка НДС в чеке (по умолчанию `none`) |
| `TOKEN_PACKAGE_*` | Переопределение цен пакетов (опционально) |

## Тестирование

- **Юнит:** `signature.ts` воспроизводит эталонный хеш `72dd466f…` из документации;
  проверка валидной/невалидной подписи вебхука.
- **Юнит/интеграция:** идемпотентность — двойной `CONFIRMED`-вебхук → одно начисление,
  один `Transaction{CREDIT}`.
- **Интеграция:** `create` создаёт `Payment` и зовёт Init (клиент замокан); `webhook`
  с невалидной подписью не начисляет; расхождение `Amount` не начисляет.
- **Сквозной:** тестовый терминал Т-Банка — реальный редирект и вебхук до боевого запуска.

## Границы (не входит в MVP)

- Встроенный виджет/iframe (возможная полировка позже).
- Самовозврат токенов пользователем.
- Рекуррентные платежи/автопополнение (`Recurrent`/`RebillId`) — схема банка поддерживает,
  но сейчас не нужно.
- Админ-UI для управления секретом терминала (пока ENV).

## Что владелец делает в банке (выдаётся отдельным чек-листом перед реализацией)

Подключить интернет-эквайринг + облачную кассу («Чеки»); получить `TerminalKey` и `Password`
(боевой и тестовый терминалы); указать `NotificationURL`; подтвердить СНО и ставку НДС;
включить одностадийную оплату и нужные способы (карты, СБП, T-Pay).
