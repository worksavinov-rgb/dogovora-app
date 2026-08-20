# Физлица и самозанятые как стороны договора — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю заводить физлицо и самозанятого — и как «Мои реквизиты», и как контрагента — чтобы такие стороны корректно попадали в шапку и блок реквизитов договора.

**Architecture:** Переиспользуем enum `ProfileType` (добавив `SELF_EMPLOYED`) и вешаем его на новое поле `Counterparty.type`. Паспортные поля — плоские колонки в `Profile` и `Counterparty`. Рендер шапки/реквизитов (`html-document.ts`) получает явные ветки под физлицо/самозанятого для обеих сторон. UI-формы получают выбор типа и паспортный блок; паспорт маскируется перед отправкой в ИИ.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Prisma + PostgreSQL, Zod, Vitest, Tailwind.

## Global Constraints

- Интерфейс только на русском; коммиты на русском.
- Версии/согласия append-only — не трогаем.
- **Все новые поля необязательны.** Валидация проверяет только формат непустого значения, не требует заполнения.
- Содержимое договоров и ПДн не логируем (`console.*`/логгер — только счётчики/коды).
- Паспорт — ПДн: маскируется перед ИИ.
- Цвета/шрифты — из токенов; одна primary-кнопка на экран.
- Прогон после каждой задачи: `cd apps/web && pnpm test:run` (изменённые тесты) и `pnpm typecheck`.

---

### Task 1: Схема БД и миграция

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (enum `ProfileType` ~113-120; model `Profile` ~79-111; model `Counterparty` ~124-147)
- Create: `apps/web/prisma/migrations/<timestamp>_add_individual_parties/migration.sql`

**Interfaces:**
- Produces: колонки `Counterparty.type` (ProfileType, NOT NULL), и в обеих моделях `passportSeries/passportNumber/passportIssuedBy/passportIssueDate/passportDeptCode/npdRegisteredDate/actualAddress` (все `String?`), `Profile.phone String?`; enum-значение `ProfileType.SELF_EMPLOYED`.

- [ ] **Step 1: Добавить `SELF_EMPLOYED` в enum**

В `schema.prisma`, enum `ProfileType`, после `INDIVIDUAL`:

```prisma
enum ProfileType {
  INDIVIDUAL        // Физлицо
  SELF_EMPLOYED     // Самозанятый (плательщик НПД)
  SOLE_PROPRIETOR   // ИП
  COMPANY           // ООО / АО
  ANO
  PAO
  ZAO
}
```

- [ ] **Step 2: Добавить поля в `Profile`**

В модель `Profile` (после `legalAddress`) добавить:

```prisma
  actualAddress    String?
  phone            String?
  passportSeries   String?
  passportNumber   String?
  passportIssuedBy String?
  passportIssueDate String?
  passportDeptCode String?
  npdRegisteredDate String?
```

- [ ] **Step 3: Добавить поля в `Counterparty`**

В модель `Counterparty` добавить `type` (после `name`) и паспортный блок (после `legalAddress`):

```prisma
model Counterparty {
  id           String   @id @default(cuid())
  userId       String
  type         ProfileType @default(COMPANY)
  name         String
  inn          String?
  kpp          String?
  ogrn         String?
  legalAddress String?
  actualAddress String?
  passportSeries   String?
  passportNumber   String?
  passportIssuedBy String?
  passportIssueDate String?
  passportDeptCode String?
  npdRegisteredDate String?
  email        String?
  phone        String?
  ...
```

(`@default(COMPANY)` нужен, чтобы новые контрагенты без явного типа не падали; backfill существующих — в SQL ниже.)

- [ ] **Step 4: Сгенерировать пустую миграцию**

Run: `cd apps/web && pnpm prisma migrate dev --create-only --name add_individual_parties`
Expected: создан каталог `prisma/migrations/<ts>_add_individual_parties/migration.sql` (ещё не применён).

- [ ] **Step 5: Заменить backfill `type` в SQL миграции**

Открыть сгенерированный `migration.sql`. Prisma сгенерирует `ADD COLUMN "type" ... NOT NULL DEFAULT 'COMPANY'`. Убедиться, что существующие контрагенты получают тип по эвристике (не все COMPANY). Добавить **после** блока `ALTER TABLE "counterparties" ADD COLUMN`ов и до конца файла:

```sql
-- Backfill: существующим контрагентам ставим тип по наличию КПП (как старая эвристика)
UPDATE "counterparties"
SET "type" = CASE
  WHEN "kpp" IS NOT NULL AND "kpp" <> '' THEN 'COMPANY'::"ProfileType"
  ELSE 'SOLE_PROPRIETOR'::"ProfileType"
END;
```

(Значения `COMPANY`/`SOLE_PROPRIETOR` уже существовали в enum — конфликта с новым `SELF_EMPLOYED` в этой транзакции нет.)

- [ ] **Step 6: Применить миграцию и перегенерировать клиент**

Run: `cd apps/web && pnpm prisma migrate dev && pnpm prisma generate`
Expected: миграция применена без ошибок; клиент перегенерирован.

- [ ] **Step 7: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS (типы Prisma-клиента знают новые поля).

- [ ] **Step 8: Commit**

```bash
git add apps/web/prisma
git commit -m "БД: тип контрагента и паспортные поля для физлиц/самозанятых"
```

---

### Task 2: Типы данных сторон

**Files:**
- Modify: `apps/web/src/lib/ai/types.ts` (`UserProfileData` 5-21, `CounterpartyData` 24-39)

**Interfaces:**
- Consumes: ничего.
- Produces: поля `type` в `CounterpartyData`; `passportSeries/passportNumber/passportIssuedBy/passportIssueDate/passportDeptCode/npdRegisteredDate/actualAddress` в обоих интерфейсах. Все `string | null` опциональны.

- [ ] **Step 1: Расширить `UserProfileData`**

Добавить в интерфейс `UserProfileData` (после `email`):

```ts
  phone?: string | null
  actualAddress?: string | null
  passportSeries?: string | null
  passportNumber?: string | null
  passportIssuedBy?: string | null
  passportIssueDate?: string | null
  passportDeptCode?: string | null
  npdRegisteredDate?: string | null
```

- [ ] **Step 2: Расширить `CounterpartyData`**

Добавить в интерфейс `CounterpartyData`: `type` (первой строкой) и паспортный блок:

```ts
export interface CounterpartyData {
  type?: string         // INDIVIDUAL | SELF_EMPLOYED | SOLE_PROPRIETOR | COMPANY | ANO | PAO | ZAO
  name: string
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  actualAddress?: string | null
  passportSeries?: string | null
  passportNumber?: string | null
  passportIssuedBy?: string | null
  passportIssueDate?: string | null
  passportDeptCode?: string | null
  npdRegisteredDate?: string | null
  email?: string | null
  ...
```

(`type` опционален, чтобы старый код, собиравший `CounterpartyData` без типа, ещё компилировался; рендер использует fallback по КПП.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/ai/types.ts
git commit -m "Типы: паспортные поля и тип контрагента в данных сторон"
```

---

### Task 3: Валидаторы паспорта (TDD)

**Files:**
- Modify: `apps/web/src/lib/validation.ts`
- Create: `apps/web/tests/passport-validation.test.ts`

**Interfaces:**
- Produces: `validatePassportSeries(v: string): string | null`, `validatePassportNumber(v: string): string | null`, `validatePassportDeptCode(v: string): string | null`. Пустая строка → `null` (валидно, поля необязательны).

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/passport-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  validatePassportSeries,
  validatePassportNumber,
  validatePassportDeptCode,
} from '@/lib/validation'

describe('паспортные валидаторы — пустое значение допустимо (поля необязательны)', () => {
  it('пустая строка везде валидна', () => {
    expect(validatePassportSeries('')).toBeNull()
    expect(validatePassportNumber('')).toBeNull()
    expect(validatePassportDeptCode('')).toBeNull()
  })
})

describe('validatePassportSeries', () => {
  it('4 цифры — ок', () => expect(validatePassportSeries('1234')).toBeNull())
  it('не 4 цифры — ошибка', () => expect(validatePassportSeries('12')).toMatch(/4 цифры/))
  it('буквы — ошибка', () => expect(validatePassportSeries('12ab')).toMatch(/цифр/))
})

describe('validatePassportNumber', () => {
  it('6 цифр — ок', () => expect(validatePassportNumber('567890')).toBeNull())
  it('не 6 цифр — ошибка', () => expect(validatePassportNumber('5678')).toMatch(/6 цифр/))
})

describe('validatePassportDeptCode', () => {
  it('формат NNN-NNN — ок', () => expect(validatePassportDeptCode('770-053')).toBeNull())
  it('без дефиса — ошибка', () => expect(validatePassportDeptCode('770053')).toMatch(/подразделения/))
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd apps/web && pnpm test:run passport-validation`
Expected: FAIL — функции не экспортированы.

- [ ] **Step 3: Реализовать валидаторы**

В конец `apps/web/src/lib/validation.ts`:

```ts
// ─── Паспорт РФ (все поля необязательны — пустое значение валидно) ─────────────

export function validatePassportSeries(v: string): string | null {
  if (!v) return null
  if (!/^\d{4}$/.test(v)) return 'Серия паспорта — 4 цифры'
  return null
}

export function validatePassportNumber(v: string): string | null {
  if (!v) return null
  if (!/^\d{6}$/.test(v)) return 'Номер паспорта — 6 цифр'
  return null
}

export function validatePassportDeptCode(v: string): string | null {
  if (!v) return null
  if (!/^\d{3}-\d{3}$/.test(v)) return 'Код подразделения — в формате 000-000'
  return null
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd apps/web && pnpm test:run passport-validation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/validation.ts apps/web/tests/passport-validation.test.ts
git commit -m "Валидация: серия/номер паспорта и код подразделения"
```

---

### Task 4: Шапка (преамбула) для физлица/самозанятого (TDD)

**Files:**
- Modify: `apps/web/src/lib/html-document.ts` (`TYPE_RU` 702-706; `buildPartyPreambleParts` 756-792)
- Modify: `apps/web/tests/preamble-blocks.test.ts` (добавить describe-блок)

**Interfaces:**
- Consumes: `CounterpartyData.type` и паспортные поля (Task 2).
- Produces: `buildPartyPreambleParts` формирует предложение для физлица/самозанятого на любой из сторон (без «в лице/на основании»).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `apps/web/tests/preamble-blocks.test.ts` (после существующих describe):

```ts
describe('buildContractPreambleHtml — физлицо и самозанятый как стороны', () => {
  const INDIVIDUAL_CP: CounterpartyData = {
    type: 'INDIVIDUAL',
    name: 'Иванов Иван Иванович',
    passportSeries: '1234',
    passportNumber: '567890',
    passportIssuedBy: 'ОВД г. Москвы',
    passportIssueDate: '10.05.2015',
    legalAddress: 'г. Москва, ул. Мира, д. 3',
  } as CounterpartyData

  it('контрагент-физлицо: ФИО + паспорт, без «в лице»/«на основании»', () => {
    const html = buildContractPreambleHtml(PROFILE, INDIVIDUAL_CP, 'Заказчик', 'Исполнитель')
    expect(html).toContain('Иванов Иван Иванович')
    expect(html).toContain('паспорт 1234 № 567890')
    expect(html).toContain('именуемый в дальнейшем «Исполнитель»')
    // в предложении физлица нет оборотов юрлица/ИП
    const partySentence = html.slice(html.indexOf('Иванов'))
    expect(partySentence).not.toContain('в лице')
    expect(partySentence).not.toContain('действующего на основании')
  })

  it('контрагент-самозанятый: добавляется оговорка про НПД', () => {
    const smz = { ...INDIVIDUAL_CP, type: 'SELF_EMPLOYED' } as CounterpartyData
    const html = buildContractPreambleHtml(PROFILE, smz, 'Заказчик', 'Исполнитель')
    expect(html).toContain('Налог на профессиональный доход')
  })

  it('профиль-физлицо больше не рендерится как юрлицо', () => {
    const indProfile = {
      type: 'INDIVIDUAL',
      name: 'Петров Пётр Петрович',
      passportSeries: '4321',
      passportNumber: '098765',
    } as UserProfileData
    const html = buildContractPreambleHtml(indProfile, COUNTERPARTY, 'Заказчик', 'Исполнитель')
    const p1 = html.slice(html.indexOf('Петров'), html.indexOf('ООО «АЙЛАБМЕД»'))
    expect(p1).not.toContain('действующего на основании Устава')
    expect(p1).toContain('именуемый в дальнейшем «Заказчик»')
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd apps/web && pnpm test:run preamble-blocks`
Expected: FAIL (профиль-физлицо уходит в юрлицо-ветку; у контрагента нет типа/паспорта).

- [ ] **Step 3: Добавить `SELF_EMPLOYED` в `TYPE_RU`**

В `html-document.ts`, `TYPE_RU`:

```ts
const TYPE_RU: Record<string, string> = {
  SOLE_PROPRIETOR: 'Индивидуальный предприниматель',
  COMPANY: 'Общество с ограниченной ответственностью',
  INDIVIDUAL: '',
  SELF_EMPLOYED: '',
}
```

- [ ] **Step 4: Добавить хелперы и ветки физлица в `buildPartyPreambleParts`**

Перед функцией `buildPartyPreambleParts` добавить хелперы:

```ts
function isIndividualType(type: string | null | undefined): boolean {
  return type === 'INDIVIDUAL' || type === 'SELF_EMPLOYED'
}

// Предложение-представление физлица/самозанятого: ФИО, паспорт, адрес регистрации,
// (для самозанятого) оговорка про НПД. Без «в лице …, действующего на основании …» —
// физлицо по ГК ст. 160 подписывает лично.
function individualPreambleSentence(
  party: {
    name?: string | null
    passportSeries?: string | null
    passportNumber?: string | null
    passportIssuedBy?: string | null
    passportIssueDate?: string | null
    legalAddress?: string | null
  },
  type: string,
  role: string,
  tail: string,
): string {
  const bits: string[] = [esc(party.name ?? '')]
  const sn = [party.passportSeries, party.passportNumber].filter(Boolean).join(' № ')
  if (sn) {
    let pass = `паспорт ${sn}`
    const issued = [party.passportIssuedBy, party.passportIssueDate].filter(Boolean).join(' ')
    if (issued) pass += `, выдан ${issued}`
    bits.push(esc(pass))
  }
  if (party.legalAddress) bits.push(`зарегистрирован по адресу ${esc(party.legalAddress)}`)
  if (type === 'SELF_EMPLOYED') bits.push('применяющий специальный налоговый режим «Налог на профессиональный доход»')
  return `${bits.join(', ')}, именуемый в дальнейшем «${esc(role)}», ${tail}`
}
```

Затем в `buildPartyPreambleParts` заменить вычисление `p2Type` и добавить ветки физлица для обеих сторон:

```ts
function buildPartyPreambleParts(
  userProfile: UserProfileData,
  counterparty: CounterpartyData,
  role1: string,
  role2: string,
): string[] {
  const p1Type = userProfile.type
  const p2Type = counterparty.type ?? (counterparty.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR')
  const p1FullName = partyFullName(userProfile.name, p1Type)
  const p2FullName = partyFullName(counterparty.name, p2Type)
  const p1Basis = buildBasisPhrase(p1Type, userProfile.ogrn, userProfile.signatorBasis, userProfile.ogrnDate)
  const p2Basis = buildBasisPhrase(p2Type, counterparty.ogrn, counterparty.signatorBasis)

  const parts: string[] = []

  // ── Сторона 1 ──
  if (isIndividualType(p1Type)) {
    parts.push(individualPreambleSentence(userProfile, p1Type, role1, 'с одной стороны, и'))
  } else if (p1Type === 'SOLE_PROPRIETOR') {
    parts.push(`${esc(p1FullName)}, именуемый в дальнейшем «${esc(role1)}», действующий на основании ${esc(p1Basis)}, с одной стороны, и`)
  } else {
    const signatorPhrase = userProfile.signatorName
      ? `в лице ${esc(userProfile.signatorPosition ?? 'директора')} ${esc(userProfile.signatorName)}, действующего на основании ${esc(p1Basis)},`
      : ''
    parts.push(`${esc(p1FullName)} ${signatorPhrase} именуемое в дальнейшем «${esc(role1)}», с одной стороны, и`)
  }

  // ── Сторона 2 ──
  if (isIndividualType(p2Type)) {
    parts.push(individualPreambleSentence(counterparty, p2Type, role2, 'с другой стороны,'))
  } else if (p2Type === 'SOLE_PROPRIETOR') {
    const signLine = counterparty.signatorName ? esc(counterparty.signatorName) : '____________'
    const basisLine = counterparty.signatorName ? esc(p2Basis) : '_____________'
    parts.push(`Индивидуальный предприниматель ${signLine}, именуемый в дальнейшем «${esc(role2)}», действующий на основании ${basisLine}, с другой стороны,`)
  } else {
    const signPhrase = counterparty.signatorName
      ? `в лице ${esc(counterparty.signatorPosition ?? 'директора')} ${esc(counterparty.signatorName)}, действующего на основании ${esc(p2Basis)},`
      : 'в лице _____________, действующего на основании _____________,'
    parts.push(`${esc(p2FullName)} ${signPhrase} именуемое в дальнейшем «${esc(role2)}», с другой стороны,`)
  }

  return parts
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит (и старые тесты живы)**

Run: `cd apps/web && pnpm test:run preamble-blocks presentation-preamble`
Expected: PASS (в т.ч. существующие тесты юрлиц/ИП).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/html-document.ts apps/web/tests/preamble-blocks.test.ts
git commit -m "Шапка: ветка физлица/самозанятого для обеих сторон"
```

---

### Task 5: Блок «Реквизиты сторон» для физлица/самозанятого (TDD)

**Files:**
- Modify: `apps/web/src/lib/html-document.ts` (`buildPartyLines` 1042-1070)
- Create: `apps/web/tests/requisites-individual.test.ts`

**Interfaces:**
- Consumes: паспортные поля и `type` из Task 2.
- Produces: `buildRequisitesHtml` для физлица показывает ФИО/паспорт/адрес/ИНН/банк, скрывает КПП/ОГРН; для самозанятого добавляет строку про НПД.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/requisites-individual.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ prisma: {} }))
import { buildRequisitesHtml } from '@/lib/html-document'
import type { CounterpartyData, UserProfileData } from '@/lib/ai/types'

const PROFILE: UserProfileData = {
  type: 'COMPANY', name: 'ООО «Догодок»', inn: '7714415571', kpp: '771401001', ogrn: '1157746000000',
} as UserProfileData

describe('buildRequisitesHtml — физлицо/самозанятый', () => {
  it('физлицо: паспорт есть, КПП/ОГРН нет', () => {
    const cp: CounterpartyData = {
      type: 'INDIVIDUAL', name: 'Иванов Иван Иванович',
      inn: '500100732259', passportSeries: '1234', passportNumber: '567890',
      passportIssuedBy: 'ОВД', passportIssueDate: '10.05.2015', passportDeptCode: '770-053',
      legalAddress: 'г. Москва',
    } as CounterpartyData
    const html = buildRequisitesHtml(PROFILE, cp, 'Заказчик', 'Исполнитель')
    expect(html).toContain('Паспорт: 1234 № 567890')
    expect(html).toContain('ИНН: 500100732259')
    expect(html).not.toContain('КПП')
    expect(html).not.toContain('ОГРН')
  })

  it('самозанятый: строка про НПД', () => {
    const cp: CounterpartyData = {
      type: 'SELF_EMPLOYED', name: 'Петров Пётр', inn: '500100732259',
    } as CounterpartyData
    const html = buildRequisitesHtml(PROFILE, cp, 'Заказчик', 'Исполнитель')
    expect(html).toMatch(/налог на профессиональный доход/i)
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd apps/web && pnpm test:run requisites-individual`
Expected: FAIL (нет паспортных строк; для контрагента без КПП сейчас показывается ОГРНИП).

- [ ] **Step 3: Переписать `buildPartyLines`**

Заменить тело `buildPartyLines` (сохранив сигнатуру):

```ts
function buildPartyLines(party: UserProfileData | CounterpartyData, role: string): string[] {
  const lines: string[] = []

  lines.push(`<strong>${role}:</strong>`)
  lines.push(esc(party.name ?? ''))

  const type = 'type' in party && party.type ? party.type : (party.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR')
  const individual = type === 'INDIVIDUAL' || type === 'SELF_EMPLOYED'
  const isSoleProprietor = type === 'SOLE_PROPRIETOR'

  if (party.legalAddress) lines.push(`${individual ? 'Адрес регистрации' : 'Адрес'}: ${esc(party.legalAddress)}`)
  if (party.inn) lines.push(`ИНН: ${esc(party.inn)}`)
  if (!individual && party.kpp) lines.push(`КПП: ${esc(party.kpp)}`)
  if (!individual && party.ogrn) lines.push(`${isSoleProprietor ? 'ОГРНИП' : 'ОГРН'}: ${esc(party.ogrn)}`)

  // Паспорт (только физлицо/самозанятый)
  if (individual) {
    const sn = [party.passportSeries, party.passportNumber].filter(Boolean).join(' № ')
    if (sn) lines.push(`Паспорт: ${esc(sn)}`)
    const issued = [
      party.passportIssuedBy,
      party.passportIssueDate,
      party.passportDeptCode ? `код подразделения ${party.passportDeptCode}` : '',
    ].filter(Boolean).join(', ')
    if (issued) lines.push(`Выдан: ${esc(issued)}`)
  }
  if (type === 'SELF_EMPLOYED') {
    lines.push('Применяет налог на профессиональный доход (НПД)')
  }

  // Банковские реквизиты
  if (party.bankName)             lines.push(`Банк: ${esc(party.bankName)}`)
  if (party.bik)                  lines.push(`БИК: ${esc(party.bik)}`)
  if (party.checkingAccount)      lines.push(`Р/счет: ${esc(party.checkingAccount)}`)
  if (party.correspondentAccount) lines.push(`К/счет: ${esc(party.correspondentAccount)}`)

  if (party.email) lines.push(`E-mail: ${esc(party.email)}`)

  if (party.signatorName) lines.push(esc(party.signatorName))
  if (party.signatorPosition) lines.push(esc(party.signatorPosition))

  return lines
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит (и старые тесты живы)**

Run: `cd apps/web && pnpm test:run requisites-individual requisites-split replace-requisites`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/html-document.ts apps/web/tests/requisites-individual.test.ts
git commit -m "Реквизиты: паспортный блок физлица и строка НПД самозанятого"
```

---

### Task 6: Маскировка паспорта перед ИИ (TDD)

**Files:**
- Modify: `apps/web/src/lib/anonymize.ts` (`maskPartyForAI` 71-85)
- Create: `apps/web/tests/anonymize-passport.test.ts`

**Interfaces:**
- Produces: `maskPartyForAI` заменяет паспортные поля на метки `[PASSPORTSERIES]` и т.п.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/anonymize-passport.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { maskPartyForAI } from '@/lib/anonymize'

describe('maskPartyForAI — паспортные поля', () => {
  it('серия/номер/кем выдан/дата/код и НПД маскируются', () => {
    const masked = maskPartyForAI({
      name: 'Иванов Иван',
      passportSeries: '1234', passportNumber: '567890',
      passportIssuedBy: 'ОВД', passportIssueDate: '10.05.2015',
      passportDeptCode: '770-053', npdRegisteredDate: '01.01.2024',
    })!
    expect(masked.passportSeries).toBe('[PASSPORTSERIES]')
    expect(masked.passportNumber).toBe('[PASSPORTNUMBER]')
    expect(masked.passportIssuedBy).toBe('[PASSPORTISSUEDBY]')
    expect(masked.passportIssueDate).toBe('[PASSPORTISSUEDATE]')
    expect(masked.passportDeptCode).toBe('[PASSPORTDEPTCODE]')
    expect(masked.npdRegisteredDate).toBe('[NPDREGISTEREDDATE]')
    expect(masked.name).toBe('Иванов Иван') // имя маскируется отдельным механизмом
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd apps/web && pnpm test:run anonymize-passport`
Expected: FAIL (паспортные ключи не маскируются).

- [ ] **Step 3: Дополнить `secretKeys`**

В `maskPartyForAI` добавить ключи в массив `secretKeys`:

```ts
  const secretKeys = [
    'inn', 'kpp', 'ogrn', 'ogrnip', 'ogrnDate', 'email', 'phone',
    'legalAddress', 'actualAddress',
    'passportSeries', 'passportNumber', 'passportIssuedBy', 'passportIssueDate',
    'passportDeptCode', 'npdRegisteredDate',
    'bankName', 'checkingAccount', 'bik', 'correspondentAccount',
  ]
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd apps/web && pnpm test:run anonymize-passport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/anonymize.ts apps/web/tests/anonymize-passport.test.ts
git commit -m "ПДн: маскировка паспортных полей перед ИИ"
```

---

### Task 7: Проброс типа и паспорта контрагента в сборку сторон

**Files:**
- Modify: `apps/web/src/lib/party-data.ts` (`buildDocumentParties` — объекты `userProfile` 64-85 и `counterpartyData` 97-118)
- Modify: `apps/web/src/lib/presentation-content.ts` (`getReferenceBlocks` — объекты `userProfile` 65-81 и `counterpartyData` 83-98)

**Interfaces:**
- Consumes: колонки из Task 1, поля типов из Task 2.
- Produces: `counterpartyData.type` и паспортные поля обеих сторон доходят до `buildContractPreambleHtml`/`buildRequisitesHtml`.

- [ ] **Step 1: Добавить поля в `userProfile` и `counterpartyData` в `party-data.ts`**

В объект `userProfile` (после `email: profile.email ?? null,`) добавить:

```ts
    phone: profile.phone ?? null,
    actualAddress: profile.actualAddress ?? null,
    passportSeries: profile.passportSeries ?? null,
    passportNumber: profile.passportNumber ?? null,
    passportIssuedBy: profile.passportIssuedBy ?? null,
    passportIssueDate: profile.passportIssueDate ?? null,
    passportDeptCode: profile.passportDeptCode ?? null,
    npdRegisteredDate: profile.npdRegisteredDate ?? null,
```

В объект `counterpartyData` (после `name: cp.name,`) добавить `type: cp.type,` и (после `legalAddress: cp.legalAddress,`) паспортный блок:

```ts
      type: cp.type,
      ...
      actualAddress: cp.actualAddress,
      passportSeries: cp.passportSeries,
      passportNumber: cp.passportNumber,
      passportIssuedBy: cp.passportIssuedBy,
      passportIssueDate: cp.passportIssueDate,
      passportDeptCode: cp.passportDeptCode,
      npdRegisteredDate: cp.npdRegisteredDate,
```

- [ ] **Step 2: Те же поля в `presentation-content.ts`**

В `getReferenceBlocks` добавить те же поля в объект `userProfile` (после `email: profile.email ?? null,`) и в `counterpartyData` (`type: cp.type,` после `name`, и паспортный блок после `legalAddress`). Код идентичен Step 1.

- [ ] **Step 3: Typecheck и существующие тесты**

Run: `cd apps/web && pnpm typecheck && pnpm test:run presentation-preamble preamble-blocks`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/party-data.ts apps/web/src/lib/presentation-content.ts
git commit -m "Сборка сторон: тип и паспорт контрагента/профиля доходят до рендера"
```

---

### Task 8: API контрагентов — тип и паспортные поля

**Files:**
- Modify: `apps/web/src/app/api/counterparties/route.ts` (`createSchema` 6-28, POST 87-113)
- Modify: `apps/web/src/app/api/counterparties/[id]/route.ts` (`updateSchema` 14-28, PUT 72-74)

**Interfaces:**
- Consumes: колонки Task 1.
- Produces: POST/PUT принимают и сохраняют `type` (enum) + паспортные поля + `actualAddress` + `npdRegisteredDate`.

- [ ] **Step 1: Обновить `createSchema` и сохранение (POST)**

В `createSchema` заменить `orgForm` на `type` и добавить паспортные поля:

```ts
const TYPE_ENUM = z.enum(['INDIVIDUAL','SELF_EMPLOYED','SOLE_PROPRIETOR','COMPANY','ANO','PAO','ZAO'])

const createSchema = z.object({
  name: z.string().min(1, 'Укажите название'),
  type: TYPE_ENUM.default('COMPANY'),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  legalAddress: z.string().optional(),
  actualAddress: z.string().optional(),
  passportSeries: z.string().optional(),
  passportNumber: z.string().optional(),
  passportIssuedBy: z.string().optional(),
  passportIssueDate: z.string().optional(),
  passportDeptCode: z.string().optional(),
  npdRegisteredDate: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
  signatory: z.object({
    fullName: z.string().min(1),
    signatureName: z.string().default(''),
    position: z.string().default(''),
    basisType: z.enum(['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']).default('CHARTER'),
    basisText: z.string().optional(),
  }).optional(),
})
```

В POST убрать `orgForm` из деструктуризации (его больше нет), оставить `actualAddress` в `cpData` (теперь это колонка) — то есть НЕ вырезать `actualAddress`:

```ts
  const { bankName, checkingAccount, bik, correspondentAccount, signatory, ...cpData } = data
```

(`cpData` теперь содержит `type`, `actualAddress`, паспортные поля — все они колонки, сохранятся напрямую.)

- [ ] **Step 2: Обновить `updateSchema` и PUT**

В `[id]/route.ts` `updateSchema` добавить:

```ts
  type: z.enum(['INDIVIDUAL','SELF_EMPLOYED','SOLE_PROPRIETOR','COMPANY','ANO','PAO','ZAO']).optional(),
  actualAddress: z.string().optional().nullable(),
  passportSeries: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  passportIssuedBy: z.string().optional().nullable(),
  passportIssueDate: z.string().optional().nullable(),
  passportDeptCode: z.string().optional().nullable(),
  npdRegisteredDate: z.string().optional().nullable(),
```

PUT уже делает `prisma.counterparty.update({ data: cpData })` после вырезания банковских полей — новые колонки попадут автоматически. Проверить, что в деструктуризации (строка 72) вырезаются только банковские поля.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/counterparties
git commit -m "API контрагентов: тип и паспортные поля в create/update"
```

---

### Task 9: API профилей — SELF_EMPLOYED и паспортные поля

**Files:**
- Modify: `apps/web/src/app/api/profiles/route.ts` (`profileSchema` ~21-...)
- Modify: `apps/web/src/app/api/profiles/[id]/route.ts` (`profileUpdateSchema` ~19-...)

**Interfaces:**
- Produces: create/update профиля принимают `SELF_EMPLOYED` в enum и паспортные поля/phone/npd/actualAddress.

- [ ] **Step 1: Прочитать текущие схемы**

Run: `sed -n '1,60p' apps/web/src/app/api/profiles/route.ts`
Уяснить, как объявлен `type` enum и как поля идут в `prisma.profile.create`.

- [ ] **Step 2: Добавить `SELF_EMPLOYED` в enum обоих схем**

В `profileSchema` (POST) и `profileUpdateSchema` (PUT) в список значений enum добавить `'SELF_EMPLOYED'` — рядом с `'INDIVIDUAL'`.

- [ ] **Step 3: Добавить паспортные поля в обе схемы**

Добавить в оба объекта:

```ts
  phone: z.string().optional().nullable(),
  actualAddress: z.string().optional().nullable(),
  passportSeries: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  passportIssuedBy: z.string().optional().nullable(),
  passportIssueDate: z.string().optional().nullable(),
  passportDeptCode: z.string().optional().nullable(),
  npdRegisteredDate: z.string().optional().nullable(),
```

Убедиться, что в `prisma.profile.create`/`update` данные передаются spread-ом (`...data` или явным перечислением). Если поля перечислены явно — добавить новые в объект `data`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/profiles
git commit -m "API профилей: самозанятый и паспортные поля"
```

---

### Task 10: Превью реквизитов — паспорт и самозанятый

**Files:**
- Modify: `apps/web/src/components/requisites-preview.tsx` (`RequisitesData` 5-20, `RequisitesPreview` 32-126)

**Interfaces:**
- Consumes: `type` может быть `SELF_EMPLOYED`.
- Produces: превью показывает паспортный блок и метку самозанятого; используется на форме контрагента и в реквизитах.

- [ ] **Step 1: Расширить `RequisitesData`**

Добавить в интерфейс паспортные поля:

```ts
  actualAddress?: string | null
  passportSeries?: string | null
  passportNumber?: string | null
  passportIssuedBy?: string | null
  passportIssueDate?: string | null
  passportDeptCode?: string | null
  npdRegisteredDate?: string | null
```

- [ ] **Step 2: Учесть самозанятого и паспорт в рендере**

В начале `RequisitesPreview` добавить:

```ts
  const isSelfEmployed = data.type === 'SELF_EMPLOYED'
  const isPerson = isIndividual || isSelfEmployed
```

Обновить условие `hasAnyData`, чтобы паспорт тоже считался данными:

```ts
  const hasAnyData = data.name || data.inn || data.ogrn || data.legalAddress || data.bankName || data.passportSeries
```

В блоке «Реквизиты» скрывать КПП/ОГРН для `isPerson` (заменить `!isIndividual` на `!isPerson`), и добавить паспортные строки + метку НПД после блока ИНН/ОГРН:

```tsx
        {isPerson && data.passportSeries && (
          <ReqRow label="Паспорт" value={[data.passportSeries, data.passportNumber].filter(Boolean).join(' № ')} />
        )}
        {isPerson && (data.passportIssuedBy || data.passportIssueDate) && (
          <ReqRow label="Выдан" value={[data.passportIssuedBy, data.passportIssueDate].filter(Boolean).join(', ')} />
        )}
        {isSelfEmployed && <ReqRow label="Статус" value="Плательщик НПД" />}
```

В блоке «Подпись» ветку `isIndividual` заменить на `isPerson`, чтобы самозанятый тоже подписывал лично (тот же JSX, что уже есть для `isIndividual`).

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/requisites-preview.tsx
git commit -m "Превью реквизитов: паспорт и статус самозанятого"
```

---

### Task 11: Экран «Мои реквизиты» — самозанятый и паспорт

**Files:**
- Modify: `apps/web/src/app/(app)/requisites/page.tsx`

**Interfaces:**
- Consumes: API профилей (Task 9), превью (Task 10).
- Produces: пользователь может создать профиль-самозанятого и заполнить паспорт/НПД/телефон.

- [ ] **Step 1: Прочитать файл целиком, найти опорные точки**

Run: `sed -n '1,120p' apps/web/src/app/(app)/requisites/page.tsx` (и далее по мере надобности). Опоры из разведки: `TYPE_LABELS` (~63-70), массив типов создания (~258-269), `isIndividual` (~290), скрытие ИНН/ОГРН (293, 307), состояние формы (`useState`), submit → fetch на `/api/profiles`.

- [ ] **Step 2: Добавить «Самозанятый» в лейблы/цвета и в кнопки выбора типа**

В `TYPE_LABELS` добавить `SELF_EMPLOYED: 'Самозанятый'`; в `TYPE_COLORS` — цвет по образцу `INDIVIDUAL`. В массив кнопок создания добавить `'SELF_EMPLOYED'` рядом с `'INDIVIDUAL'`:

```ts
['SOLE_PROPRIETOR', 'COMPANY', 'INDIVIDUAL', 'SELF_EMPLOYED', 'ANO', 'PAO', 'ZAO']
```

Ввести `const isPerson = profile.type === 'INDIVIDUAL' || profile.type === 'SELF_EMPLOYED'` и использовать его там, где сейчас `isIndividual`, для скрытия КПП/ОГРН.

- [ ] **Step 3: Добавить в состояние формы и поля ввода паспортный блок**

В объект состояния профиля добавить ключи `phone, actualAddress, passportSeries, passportNumber, passportIssuedBy, passportIssueDate, passportDeptCode, npdRegisteredDate` (инициализация пустой строкой / из загруженного профиля).

Добавить блок полей, видимый при `isPerson` (по образцу существующих Input-полей экрана; валидируем формат через `validatePassportSeries/Number/DeptCode` из `@/lib/validation`, но не делаем обязательными):

```tsx
{isPerson && (
  <div className="flex flex-col gap-[12px]">
    <div className="grid grid-cols-2 gap-[12px]">
      <Field label="Серия паспорта"><Input value={form.passportSeries} onChange={e => set('passportSeries', e.target.value)} placeholder="1234" /></Field>
      <Field label="Номер паспорта"><Input value={form.passportNumber} onChange={e => set('passportNumber', e.target.value)} placeholder="567890" /></Field>
    </div>
    <Field label="Кем выдан"><Input value={form.passportIssuedBy} onChange={e => set('passportIssuedBy', e.target.value)} /></Field>
    <div className="grid grid-cols-2 gap-[12px]">
      <Field label="Дата выдачи"><Input value={form.passportIssueDate} onChange={e => set('passportIssueDate', e.target.value)} placeholder="10.05.2015" /></Field>
      <Field label="Код подразделения"><Input value={form.passportDeptCode} onChange={e => set('passportDeptCode', e.target.value)} placeholder="770-053" /></Field>
    </div>
    <Field label="Адрес регистрации"><Input value={form.legalAddress} onChange={e => set('legalAddress', e.target.value)} /></Field>
    <Field label="Фактический адрес (если отличается)"><Input value={form.actualAddress} onChange={e => set('actualAddress', e.target.value)} /></Field>
    {profile.type === 'SELF_EMPLOYED' && (
      <Field label="Дата постановки на учёт НПД (необязательно)"><Input value={form.npdRegisteredDate} onChange={e => set('npdRegisteredDate', e.target.value)} placeholder="01.01.2024" /></Field>
    )}
  </div>
)}
```

(`Field`/`set`/`Input` — использовать те же обёртки, что уже применяются в файле; если их нет, повторить существующий паттерн разметки поля.)

- [ ] **Step 4: Прокинуть новые поля в submit и в превью**

Убедиться, что тело POST/PUT на `/api/profiles` включает новые ключи, а `<RequisitesPreview data={...}>` получает `type` и паспортные поля.

- [ ] **Step 5: Проверить в браузере**

Через preview-инструменты: открыть дев-сервер (`.claude/launch.json` или `preview_start`), перейти на `/requisites`, создать профиль «Самозанятый», заполнить паспорт, убедиться что превью показывает паспорт/НПД, сохранить, перезагрузить — данные на месте. Проверить консоль на ошибки.

- [ ] **Step 6: Typecheck и commit**

```bash
cd apps/web && pnpm typecheck
git add apps/web/src/app/\(app\)/requisites/page.tsx
git commit -m "Мои реквизиты: тип «Самозанятый» и паспортный блок"
```

---

### Task 12: Форма контрагента — тип, паспорт, скрытие подписантов

**Files:**
- Modify: `apps/web/src/app/(app)/counterparties/new/page.tsx`
- Modify: `apps/web/src/app/(app)/counterparties/[id]/page.tsx`

**Interfaces:**
- Consumes: API контрагентов (Task 8), превью (Task 10).
- Produces: пользователь заводит контрагента-физлицо/самозанятого; для них скрыты КПП/ОГРН/подписанты, показан паспорт; тип уходит в API.

- [ ] **Step 1: Прочитать обе страницы**

Run: `sed -n '1,120p' apps/web/src/app/(app)/counterparties/new/page.tsx` и аналогично для `[id]/page.tsx`. Опоры из разведки: `guessForm(inn)` (new ~29-33), захардкоженное превью (new ~269-291), в `[id]` превью-тип `form.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR'` (~435), раздел «Подписанты».

- [ ] **Step 2: Добавить выбор типа кнопками (обе страницы)**

Добавить в состояние формы `type` (по умолчанию `'COMPANY'` в new; из загруженного `cp.type` в `[id]`). Отрисовать ряд кнопок выбора типа по образцу `requisites/page.tsx` (лейблы из общего `TYPE_LABELS`, включить `INDIVIDUAL` и `SELF_EMPLOYED`). Ввести `const isPerson = form.type === 'INDIVIDUAL' || form.type === 'SELF_EMPLOYED'`.

Сохранить авто-подсказку по ИНН как **подсказку**: при вводе 12-значного ИНН, если тип ещё `COMPANY` по умолчанию и пользователь его не менял, можно предложить `INDIVIDUAL` (не форсируя). Минимально — оставить `guessForm` только как хинт, не перетирающий явный выбор.

- [ ] **Step 3: Условно скрыть КПП/ОГРН/подписантов, показать паспорт**

Обернуть поля КПП/ОГРН и **раздел «Подписанты»** в `{!isPerson && (...)}`. Добавить паспортный блок под `{isPerson && (...)}` — те же поля, что в Task 11 Step 3 (серия, номер, кем выдан, дата, код подразделения, адрес регистрации, фактический адрес, для самозанятого — дата НПД).

- [ ] **Step 4: Живое превью и отправка**

Заменить захардкоженное превью на общий `<RequisitesPreview data={{ type: form.type, name: form.name, inn: form.inn, kpp: form.kpp, ogrn: form.ogrn, legalAddress: form.legalAddress, passportSeries: form.passportSeries, ... }} />`. Убедиться, что тело POST (`/api/counterparties`) и PUT (`/api/counterparties/:id`) включает `type` и паспортные поля.

- [ ] **Step 5: Проверить в браузере**

Создать контрагента «Физлицо» и «Самозанятый»: убедиться, что КПП/ОГРН/подписанты скрыты, паспорт вводится, превью корректно, сохранение работает, при открытии карточки тип и паспорт на месте. Проверить консоль.

- [ ] **Step 6: Сквозная проверка договора**

Создать документ с контрагентом-физлицом, дойти до шага «Оформление»/предпросмотра: в шапке — «ФИО, паспорт …, именуемый …», без «в лице»; в реквизитах — паспорт, без КПП/ОГРН. Проверить кейс физлицо↔физлицо (профиль тоже физлицо).

- [ ] **Step 7: Typecheck и commit**

```bash
cd apps/web && pnpm typecheck
git add apps/web/src/app/\(app\)/counterparties
git commit -m "Контрагенты: тип физлицо/самозанятый, паспорт, скрытие подписантов"
```

---

## Финальная проверка

- [ ] `cd apps/web && pnpm test:run` — все тесты зелёные.
- [ ] `cd apps/web && pnpm typecheck && pnpm lint` — чисто.
- [ ] `cd apps/web && pnpm build` — сборка проходит.
- [ ] Обновить статус в `CLAUDE.md` (добавить фазу/строку про физлиц), закоммитить.
- [ ] Деплой на прод (механизм уточнить у владельца: миграция БД через `prisma migrate deploy`).

## Self-review заметки

- Существующие защитные тесты (`preamble-blocks`, `presentation-preamble`, `requisites-split`, `replace-requisites`) должны остаться зелёными — ветки юрлиц/ИП не тронуты, добавлены только новые.
- `Counterparty.type` имеет `@default(COMPANY)` в схеме + backfill в SQL, поэтому существующие контрагенты не ломаются, а рендер юрлиц/ИП для них не меняется.
- `CounterpartyData.type` опционален → старые места сборки, не обновлённые в Task 7, продолжают работать через fallback по КПП.
