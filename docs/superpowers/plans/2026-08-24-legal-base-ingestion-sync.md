# Юридическая база: наполнение и синхронизация — План 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Подключить забор данных с официального API pravo.gov.ru: клиент API, детекция поправок к отслеживаемым актам, и (после поднятия pgvector) сид ядра + воркер мониторинга.

**Architecture:** Разовый курируемый импорт текста 15 актов ядра (API его не отдаёт) + воркер, который через `/api/Documents` следит за выходом законов-поправок к отслеживаемым актам и ставит флаг «нужна ручная проверка редакции». Клиент API и логика детекции — чистые, тестируются на фикстурах без сети и БД.

**Tech Stack:** Next.js 14, Prisma, PostgreSQL 16 + pgvector, BullMQ, Vitest.

**Основание:** разведка API — `docs/legal-base/razvedka-api-pravo-gov.md`. Спека — `docs/superpowers/specs/2026-08-24-legal-base-rag-design.md`. Опирается на План 1 (модули `lib/legal/*`).

## Global Constraints

- Все git-коммиты — на русском языке; работаем в `main`, без пуша, коммитим только свои файлы явными путями (`git add <путь>`), никогда `git add .`/`-A`.
- НЕ трогать `apps/web/prisma/schema.prisma` пока в нём лежит чужая незакоммиченная правка (координация с параллельными чатами).
- Append-only редакции норм: правка закона = новая `LegalActEdition`, старая `isCurrent=false`. Никогда не UPDATE текста существующей нормы.
- В логи — только счётчики/коды/eoNumber. Запрещено логировать тексты норм и содержимое актов целиком.
- API pravo.gov.ru — только чтение; базовый URL `http://publication.pravo.gov.ru`.
- GUID типа «Федеральный закон» = `82a8bf1c-3bc7-47ed-827f-7affd43a7f27`. `PageSize` = 100 или 200 (иные значения → 400).

---

## Часть A — Клиент API и детекция (СТРОИМ СЕЙЧАС, без БД)

### Task 1: Клиент API pravo.gov.ru

**Files:**
- Create: `apps/web/src/lib/legal/pravo-client.ts`
- Test: `apps/web/tests/legal-pravo-client.test.ts`
- Fixtures (уже сняты с живого API): `apps/web/tests/fixtures/legal/document-types.json`, `apps/web/tests/fixtures/legal/documents-fz-page.json`

**Interfaces:**
- Produces:
  - `PRAVO_BASE_URL = 'http://publication.pravo.gov.ru'`
  - `DOC_TYPE_FEDERAL_LAW = '82a8bf1c-3bc7-47ed-827f-7affd43a7f27'`
  - `type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>`
  - `interface DocumentType { id: string; name: string; weight: number }`
  - `interface PravoDoc { eoNumber: string; complexName: string; name: string; number: string; documentDate: string; documentTypeId: string; pdfFileLength: number | null; pagesCount: number | null; id: string }`
  - `interface DocumentsPage { items: PravoDoc[]; itemsTotalCount: number; pagesTotalCount: number; currentPage: number }`
  - `interface SearchParams { documentTypes?: string[]; name?: string; number?: string; block?: string; documentDateFrom?: string; publishDateFrom?: string; pageSize?: 100 | 200; index?: number }`
  - `listDocumentTypes(fetchImpl?: FetchLike): Promise<DocumentType[]>`
  - `searchDocuments(params: SearchParams, fetchImpl?: FetchLike): Promise<DocumentsPage>`
  - `hasDocumentText(eoNumber: string, fetchImpl?: FetchLike): Promise<boolean>` — `/api/DocumentText?eonumber=` возвращает `true`/`false`
  - Дефолтный `fetchImpl` — обёртка над глобальным `fetch` с таймаутом 30с.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-pravo-client.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listDocumentTypes, searchDocuments, hasDocumentText,
  DOC_TYPE_FEDERAL_LAW, PRAVO_BASE_URL,
  type FetchLike,
} from '../src/lib/legal/pravo-client'

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures/legal', name), 'utf-8'))

function fakeFetch(routes: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' }
    const body = routes[key]
    return {
      ok: true, status: 200,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }
}

describe('pravo-client', () => {
  it('парсит типы документов и находит ГУИД Федерального закона', async () => {
    const f = fakeFetch({ '/api/DocumentTypes': fx('document-types.json') })
    const types = await listDocumentTypes(f)
    expect(types.length).toBeGreaterThan(0)
    expect(types.find((t) => t.id === DOC_TYPE_FEDERAL_LAW)?.name).toBe('Федеральный закон')
  })

  it('парсит страницу документов с пагинацией', async () => {
    const f = fakeFetch({ '/api/Documents': fx('documents-fz-page.json') })
    const page = await searchDocuments({ documentTypes: [DOC_TYPE_FEDERAL_LAW], pageSize: 100 }, f)
    expect(page.items.length).toBe(2)
    expect(page.items[0].eoNumber).toMatch(/^\d+$/)
    expect(page.items[0].number).toBeTruthy()
    expect(typeof page.itemsTotalCount).toBe('number')
    expect(typeof page.pagesTotalCount).toBe('number')
  })

  it('передаёт фильтры в query string', async () => {
    let called = ''
    const f: FetchLike = async (url) => { called = url; return { ok: true, status: 200, json: async () => fx('documents-fz-page.json'), text: async () => '' } }
    await searchDocuments({ documentTypes: [DOC_TYPE_FEDERAL_LAW], number: '14-ФЗ', pageSize: 100, index: 1 }, f)
    expect(called).toContain(PRAVO_BASE_URL)
    expect(called).toContain('/api/Documents')
    expect(called).toContain('DocumentTypes=82a8bf1c-3bc7-47ed-827f-7affd43a7f27')
    expect(called).toContain('Number=14-%D0%A4%D0%97') // '14-ФЗ' urlencoded
    expect(called).toContain('PageSize=100')
  })

  it('hasDocumentText возвращает булево по ответу true/false', async () => {
    const fTrue = fakeFetch({ '/api/DocumentText': 'true' })
    const fFalse = fakeFetch({ '/api/DocumentText': 'false' })
    expect(await hasDocumentText('0001202608040073', fTrue)).toBe(true)
    expect(await hasDocumentText('0001202608040078', fFalse)).toBe(false)
  })

  it('на ошибку HTTP бросает исключение', async () => {
    const f: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })
    await expect(listDocumentTypes(f)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-pravo-client.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `pravo-client.ts`**

```ts
// Клиент официального API опубликования pravo.gov.ru (только чтение).
// fetchImpl внедряется ради тестов; в проде — обёртка над глобальным fetch с таймаутом.

export const PRAVO_BASE_URL = 'http://publication.pravo.gov.ru'
export const DOC_TYPE_FEDERAL_LAW = '82a8bf1c-3bc7-47ed-827f-7affd43a7f27'

export type FetchLike = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface DocumentType {
  id: string
  name: string
  weight: number
}

export interface PravoDoc {
  eoNumber: string
  complexName: string
  name: string
  number: string
  documentDate: string
  documentTypeId: string
  pdfFileLength: number | null
  pagesCount: number | null
  id: string
}

export interface DocumentsPage {
  items: PravoDoc[]
  itemsTotalCount: number
  pagesTotalCount: number
  currentPage: number
}

export interface SearchParams {
  documentTypes?: string[]
  name?: string
  number?: string
  block?: string
  documentDateFrom?: string
  publishDateFrom?: string
  pageSize?: 100 | 200
  index?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

const defaultFetch: FetchLike = (url) =>
  fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS), headers: { Accept: 'application/json' } })

async function getJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`pravo.gov.ru ${res.status}: ${url}`)
  return res.json()
}

export async function listDocumentTypes(fetchImpl: FetchLike = defaultFetch): Promise<DocumentType[]> {
  const data = await getJson(`${PRAVO_BASE_URL}/api/DocumentTypes`, fetchImpl)
  const arr = Array.isArray(data) ? data : []
  return arr.map((t) => ({
    id: String((t as Record<string, unknown>).id ?? ''),
    name: String((t as Record<string, unknown>).name ?? ''),
    weight: Number((t as Record<string, unknown>).weight ?? 0),
  }))
}

function buildDocumentsUrl(params: SearchParams): string {
  const q = new URLSearchParams()
  for (const t of params.documentTypes ?? []) q.append('DocumentTypes', t)
  if (params.name) q.set('Name', params.name)
  if (params.number) q.set('Number', params.number)
  if (params.block) q.set('Block', params.block)
  if (params.documentDateFrom) q.set('DocumentDateFrom', params.documentDateFrom)
  if (params.publishDateFrom) q.set('PublishDateFrom', params.publishDateFrom)
  q.set('PageSize', String(params.pageSize ?? 100))
  q.set('Index', String(params.index ?? 1))
  return `${PRAVO_BASE_URL}/api/Documents?${q.toString()}`
}

function toDoc(raw: unknown): PravoDoc {
  const r = raw as Record<string, unknown>
  return {
    eoNumber: String(r.eoNumber ?? ''),
    complexName: String(r.complexName ?? ''),
    name: String(r.name ?? ''),
    number: String(r.number ?? ''),
    documentDate: String(r.documentDate ?? ''),
    documentTypeId: String(r.documentTypeId ?? ''),
    pdfFileLength: r.pdfFileLength == null ? null : Number(r.pdfFileLength),
    pagesCount: r.pagesCount == null ? null : Number(r.pagesCount),
    id: String(r.id ?? ''),
  }
}

export async function searchDocuments(
  params: SearchParams,
  fetchImpl: FetchLike = defaultFetch,
): Promise<DocumentsPage> {
  const data = (await getJson(buildDocumentsUrl(params), fetchImpl)) as Record<string, unknown>
  const items = Array.isArray(data.items) ? data.items.map(toDoc) : []
  return {
    items,
    itemsTotalCount: Number(data.itemsTotalCount ?? items.length),
    pagesTotalCount: Number(data.pagesTotalCount ?? 1),
    currentPage: Number(data.currentPage ?? params.index ?? 1),
  }
}

export async function hasDocumentText(
  eoNumber: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<boolean> {
  const res = await fetchImpl(`${PRAVO_BASE_URL}/api/DocumentText?eonumber=${encodeURIComponent(eoNumber)}`)
  if (!res.ok) throw new Error(`pravo.gov.ru ${res.status}: DocumentText ${eoNumber}`)
  const body = (await res.text()).trim().toLowerCase()
  return body === 'true'
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-pravo-client.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/legal/pravo-client.ts apps/web/tests/legal-pravo-client.test.ts apps/web/tests/fixtures/legal/document-types.json apps/web/tests/fixtures/legal/documents-fz-page.json
git commit -m "Юрбаза: клиент API pravo.gov.ru (типы, поиск, наличие текста)"
```

---

### Task 2: Детекция поправок к отслеживаемым актам

**Files:**
- Create: `apps/web/src/lib/legal/amendment-detect.ts`
- Test: `apps/web/tests/legal-amendment-detect.test.ts`

**Interfaces:**
- Consumes: `PravoDoc` из `pravo-client.ts`.
- Produces:
  - `interface TrackedAct { shortName: string; number: string; matchTerms: string[] }` — `number` напр. «14-ФЗ», `matchTerms` — узнаваемые фрагменты названия акта («об обществах с ограниченной ответственностью»).
  - `interface AmendmentHit { eoNumber: string; complexName: string; documentDate: string; matchedTerm: string }`
  - `detectAmendments(tracked: TrackedAct, docs: PravoDoc[]): AmendmentHit[]` — возвращает документы-поправки, чей `complexName` содержит любой из `matchTerms` (сравнение без регистра). Документы с `number`, совпадающим с самим отслеживаемым актом (переиздание), не считаются поправкой.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-amendment-detect.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { detectAmendments, type TrackedAct } from '../src/lib/legal/amendment-detect'
import type { PravoDoc } from '../src/lib/legal/pravo-client'

const doc = (over: Partial<PravoDoc>): PravoDoc => ({
  eoNumber: '1', complexName: '', name: '', number: '', documentDate: '2026-08-04T00:00:00',
  documentTypeId: 'x', pdfFileLength: null, pagesCount: null, id: 'i', ...over,
})

const ooo: TrackedAct = {
  shortName: '14-ФЗ', number: '14-ФЗ',
  matchTerms: ['об обществах с ограниченной ответственностью'],
}

describe('detectAmendments', () => {
  it('находит закон-поправку по фрагменту названия', () => {
    const docs = [
      doc({ eoNumber: 'a', number: '334-ФЗ', complexName: 'Федеральный закон … О внесении изменений в Федеральный закон "Об обществах с ограниченной ответственностью"' }),
      doc({ eoNumber: 'b', number: '335-ФЗ', complexName: 'Федеральный закон … О рыболовстве' }),
    ]
    const hits = detectAmendments(ooo, docs)
    expect(hits.map((h) => h.eoNumber)).toEqual(['a'])
    expect(hits[0].matchedTerm).toBe('об обществах с ограниченной ответственностью')
  })

  it('игнорирует переиздание самого акта (тот же номер)', () => {
    const docs = [doc({ eoNumber: 'c', number: '14-ФЗ', complexName: 'Федеральный закон … Об обществах с ограниченной ответственностью' })]
    expect(detectAmendments(ooo, docs)).toEqual([])
  })

  it('пустой список → пусто', () => {
    expect(detectAmendments(ooo, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-amendment-detect.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `amendment-detect.ts`**

```ts
// Детекция законов-поправок к отслеживаемому акту по названию (complexName).
// Чистая функция: воркер мониторинга (Часть B) отдаёт сюда документы из API.

import type { PravoDoc } from './pravo-client'

export interface TrackedAct {
  shortName: string
  number: string
  matchTerms: string[]
}

export interface AmendmentHit {
  eoNumber: string
  complexName: string
  documentDate: string
  matchedTerm: string
}

export function detectAmendments(tracked: TrackedAct, docs: PravoDoc[]): AmendmentHit[] {
  const terms = tracked.matchTerms.map((t) => t.toLowerCase()).filter(Boolean)
  const hits: AmendmentHit[] = []
  for (const d of docs) {
    if (d.number && d.number === tracked.number) continue // переиздание самого акта, не поправка
    const hay = d.complexName.toLowerCase()
    const term = terms.find((t) => hay.includes(t))
    if (term) {
      hits.push({
        eoNumber: d.eoNumber,
        complexName: d.complexName,
        documentDate: d.documentDate,
        matchedTerm: term,
      })
    }
  }
  return hits
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-amendment-detect.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Прогнать весь набор юрбазы**

Run: `cd apps/web && npx vitest run tests/legal-*.test.ts`
Expected: все тесты PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/legal/amendment-detect.ts apps/web/tests/legal-amendment-detect.test.ts
git commit -m "Юрбаза: детекция законов-поправок к отслеживаемым актам"
```

---

## Часть B — Наполнение и воркер (ЗАБЛОКИРОВАНО до поднятия pgvector в общей БД)

> Эти задачи требуют применённой миграции Плана 1 и работающего pgvector в dev-БД
> (`dogovora-postgres` сейчас на `postgres:16-alpine`). Выполнять после того, как владелец
> пересоздаст контейнер (`docker compose down && docker compose up -d postgres`) в согласованный
> момент. Также требуют новой правки `schema.prisma` — делать только когда файл чист от чужих
> изменений. Детализируются в отдельный под-план перед выполнением.

- **Task B1 — Схема отслеживаемых актов и алертов:** модели `LegalTrackedAct` (какие 15 актов мониторим:
  shortName, number, matchTerms[], actId) и `LegalChangeAlert` (append-only: trackedActId, eoNumber,
  complexName, documentDate, status `new|reviewed`, createdAt). Миграция. Проверить на эфемерном pgvector.
- **Task B2 — Продовый доступ к БД для ретривера:** `lib/legal/db-retrieval.ts` — обёртка `queryRows`
  над `prisma.$queryRawUnsafe(sql, ...params)` + `retrieveNormsFromDb(input)` поверх `retrieveNorms`
  (План 1). ⚠️ Проверить сериализацию `text[]` пред-фильтра и формат вектор-литерала на живой БД
  (Important-находки финального ревью Плана 1).
- **Task B3 — Реальный эмбеддер оператора:** задача `embed` в `lib/ai` (транспорт `/embeddings` для
  OpenAI-совместимых операторов) + реализация `EmbeddingClient`; fallback на `hashEmbedder` при
  недоступности. Порядок при сиде: загрузить нормы → посчитать эмбеддинги → (пере)строить ivfflat-индекс.
- **Task B4 — Сид ядра:** `scripts/legal/seed-core.ts` — читает курируемые файлы текста 15 актов
  (формат: JSON `{ act, kind, number, shortName, title, officialUrl, articles:[{articleNumber, title,
  paragraphs:[{paragraphNumber?, text}] }] }`), режет на `LegalNorm`, пишет первую `LegalActEdition`
  (`isCurrent=true`), считает эмбеддинги. Плюс сид `LegalContractTypeMap` из `CONTRACT_TYPE_ACTS`.
- **Task B5 — Воркер `legal-sync`:** BullMQ-джоба: для каждого `LegalTrackedAct` зовёт
  `searchDocuments({ documentTypes:[DOC_TYPE_FEDERAL_LAW], publishDateFrom: lastCheck })`, прогоняет
  `detectAmendments`, создаёт `LegalChangeAlert` (append-only) на новые поправки; статус ядра — в админку.
  Полностью автоматический merge поправки в текст — вне v1.

## Self-Review (Часть A)

- **Покрытие:** клиент API (типы/поиск/пагинация/наличие текста) → Task 1; детекция поправок → Task 2.
  Обе части — чистые, тестируются на снятых с живого API фикстурах, без сети и БД.
- **Заглушки:** в Части A нет — полный код и тесты. Часть B намеренно на уровне дизайна (заблокирована
  инфраструктурой и зависит от формата курируемого текста; детализируется отдельным под-планом).
- **Согласованность типов:** `PravoDoc`, `FetchLike`, `SearchParams`, `TrackedAct`, `AmendmentHit`
  определены в Task 1/2 и совпадают между задачами и с Частью B.
