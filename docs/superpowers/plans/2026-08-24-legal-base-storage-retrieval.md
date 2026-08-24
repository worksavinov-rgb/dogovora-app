# Юридическая база: хранилище и извлечение норм — План 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать хранилище норм права (append-only редакции) и модуль `retrieveNorms()`, который по типу договора и его пунктам возвращает релевантные нормы гибридным поиском (полнотекст + вектор).

**Architecture:** Postgres + pgvector. Модели `LegalAct → LegalActEdition → LegalNorm`. Извлечение — сырой SQL (FTS `to_tsvector('russian', …)` + косинусное расстояние pgvector), результаты сливаются чистой функцией ре-ранка. Эмбеддер подаётся через интерфейс `EmbeddingClient`; в тестах — детерминированный мок, поэтому весь план тестируется без сети.

**Tech Stack:** Next.js 14, Prisma, PostgreSQL 16 + pgvector, Vitest, TypeScript strict.

## Global Constraints

- Все git-коммиты — на русском языке.
- Редакции норм — **append-only**: `LegalActEdition` не обновляется и не удаляется; новая редакция акта = новая строка, старая помечается `isCurrent = false`.
- В логи (`logger`, `console.*`) — только id/счётчики/коды. Запрещено логировать тексты норм и содержимое договоров.
- Запрос ретривера строится из уже замаскированного текста (ПДн отрезаются вызывающей стороной; ретривер текст не логирует).
- Интерфейс и комментарии — на русском.
- Размерность эмбеддингов фиксирована в БД: **1536** (константа `LEGAL_EMBEDDING_DIM`). Модель эмбеддингов оператора обязана выдавать вектор этой длины; при смене модели — менять и константу, и тип колонки в новой миграции.

---

### Task 1: Инфраструктура pgvector + Prisma-модели + миграция

**Files:**
- Modify: `docker-compose.yml:1-15` (образ Postgres с pgvector)
- Modify: `docker-compose.prod.yml:58-70` (образ Postgres с pgvector)
- Modify: `apps/web/prisma/schema.prisma:1-9` (preview-фича и extension)
- Modify: `apps/web/prisma/schema.prisma` (в конец файла — enum и 4 модели)
- Create: `apps/web/prisma/migrations/20260824130000_add_legal_base/migration.sql`

**Interfaces:**
- Produces: таблицы `legal_acts`, `legal_act_editions`, `legal_norms`, `legal_contract_type_map`; на `legal_norms` — колонки `fts tsvector` (генерируемая) и `embedding vector(1536)`, индексы GIN(`fts`) и IVFFlat(`embedding`). Prisma-модели `LegalAct`, `LegalActEdition`, `LegalNorm`, `LegalContractTypeMap`.

- [ ] **Step 1: Переключить образ Postgres на pgvector (dev)**

В `docker-compose.yml` заменить строку образа сервиса postgres:

```yaml
    image: pgvector/pgvector:pg16
```

(остальные поля сервиса — порт, volume, env — не трогать).

- [ ] **Step 2: Переключить образ Postgres на pgvector (prod)**

В `docker-compose.prod.yml` заменить `image: postgres:16-alpine` на:

```yaml
    image: pgvector/pgvector:pg16
```

- [ ] **Step 3: Включить extension в datasource Prisma**

В `apps/web/prisma/schema.prisma` заменить блоки generator/datasource на:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}
```

- [ ] **Step 4: Добавить модели в конец `schema.prisma`**

```prisma
// ─── Юридическая база (нормы права) ──────────────────────────────────────────
// APPEND-ONLY редакции: правка закона = новая LegalActEdition, старая isCurrent=false.

enum LegalActKind {
  CODE          // кодекс
  FEDERAL_LAW   // федеральный закон (N-ФЗ)
  LAW_RF        // закон РФ (напр. 2300-1)
}

model LegalAct {
  id          String       @id @default(cuid())
  kind        LegalActKind
  number      String       // «14-ФЗ», «2300-1», «ГК-1» (для частей кодекса)
  shortName   String       // «ГК РФ», «ЗоЗПП», «152-ФЗ»
  title       String       // полное официальное название
  officialUrl String?      // ссылка на первоисточник
  sourceSystem String      @default("pravo.gov.ru")
  createdAt   DateTime     @default(now())

  editions LegalActEdition[]

  @@unique([kind, number])
  @@map("legal_acts")
}

model LegalActEdition {
  id           String   @id @default(cuid())
  actId        String
  editionDate  DateTime // дата редакции (по официальному источнику)
  amendedByRef String?  // каким актом внесены изменения
  sourceUrl    String?  // откуда взят текст этой редакции
  importedAt   DateTime @default(now())
  isCurrent    Boolean  @default(true)

  act   LegalAct    @relation(fields: [actId], references: [id], onDelete: Cascade)
  norms LegalNorm[]

  @@index([actId, isCurrent])
  @@map("legal_act_editions")
}

model LegalNorm {
  id              String  @id @default(cuid())
  editionId       String
  path            String  // «ч.2 ст.454 п.1»
  articleNumber   String  // «454»
  paragraphNumber String? // «1»
  title           String  @default("") // заголовок статьи, если есть
  text            String  // текст нормы
  // fts и embedding создаются в migration.sql (Prisma их не типизирует полноценно)
  fts             Unsupported("tsvector")?
  embedding       Unsupported("vector(1536)")?

  edition LegalActEdition @relation(fields: [editionId], references: [id], onDelete: Cascade)

  @@index([editionId])
  @@map("legal_norms")
}

model LegalContractTypeMap {
  id            String @id @default(cuid())
  contractType  String // ключ из ContractType (contract-types.ts)
  actShortName  String // shortName акта из LegalAct
  priority      Int    @default(100) // меньше = выше в пред-фильтре

  @@unique([contractType, actShortName])
  @@map("legal_contract_type_map")
}
```

- [ ] **Step 5: Создать пустую миграцию и записать SQL**

Run:
```bash
cd apps/web && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /dev/null 2>&1 || true
mkdir -p prisma/migrations/20260824130000_add_legal_base
```

Записать в `apps/web/prisma/migrations/20260824130000_add_legal_base/migration.sql`:

```sql
-- pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- enum
CREATE TYPE "LegalActKind" AS ENUM ('CODE', 'FEDERAL_LAW', 'LAW_RF');

-- legal_acts
CREATE TABLE "legal_acts" (
  "id" TEXT NOT NULL,
  "kind" "LegalActKind" NOT NULL,
  "number" TEXT NOT NULL,
  "shortName" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "officialUrl" TEXT,
  "sourceSystem" TEXT NOT NULL DEFAULT 'pravo.gov.ru',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_acts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_acts_kind_number_key" ON "legal_acts"("kind", "number");

-- legal_act_editions
CREATE TABLE "legal_act_editions" (
  "id" TEXT NOT NULL,
  "actId" TEXT NOT NULL,
  "editionDate" TIMESTAMP(3) NOT NULL,
  "amendedByRef" TEXT,
  "sourceUrl" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "legal_act_editions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "legal_act_editions_actId_isCurrent_idx" ON "legal_act_editions"("actId", "isCurrent");
ALTER TABLE "legal_act_editions"
  ADD CONSTRAINT "legal_act_editions_actId_fkey"
  FOREIGN KEY ("actId") REFERENCES "legal_acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- legal_norms (fts — генерируемая колонка; embedding — pgvector)
CREATE TABLE "legal_norms" (
  "id" TEXT NOT NULL,
  "editionId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "articleNumber" TEXT NOT NULL,
  "paragraphNumber" TEXT,
  "title" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL,
  "fts" tsvector GENERATED ALWAYS AS (
    to_tsvector('russian', coalesce("title", '') || ' ' || coalesce("text", ''))
  ) STORED,
  "embedding" vector(1536),
  CONSTRAINT "legal_norms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "legal_norms_editionId_idx" ON "legal_norms"("editionId");
CREATE INDEX "legal_norms_fts_idx" ON "legal_norms" USING GIN ("fts");
CREATE INDEX "legal_norms_embedding_idx" ON "legal_norms"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
ALTER TABLE "legal_norms"
  ADD CONSTRAINT "legal_norms_editionId_fkey"
  FOREIGN KEY ("editionId") REFERENCES "legal_act_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- legal_contract_type_map
CREATE TABLE "legal_contract_type_map" (
  "id" TEXT NOT NULL,
  "contractType" TEXT NOT NULL,
  "actShortName" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  CONSTRAINT "legal_contract_type_map_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_contract_type_map_contractType_actShortName_key"
  ON "legal_contract_type_map"("contractType", "actShortName");
```

- [ ] **Step 6: Применить миграцию и сгенерировать клиент**

Run:
```bash
cd apps/web && npx prisma migrate deploy && npx prisma generate
```
Expected: миграция `20260824130000_add_legal_base` применена без ошибок; клиент сгенерирован.

- [ ] **Step 7: Проверить, что pgvector и таблицы на месте**

Run:
```bash
cd apps/web && npx prisma db execute --stdin <<'SQL'
SELECT extname FROM pg_extension WHERE extname = 'vector';
SELECT to_regclass('legal_norms') IS NOT NULL AS has_norms;
SQL
```
Expected: строка с `vector`; `has_norms = t`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml apps/web/prisma/schema.prisma apps/web/prisma/migrations/20260824130000_add_legal_base/migration.sql
git commit -m "Юрбаза: схема норм (LegalAct/Edition/Norm) + pgvector и FTS"
```

---

### Task 2: Константы корпуса и нормализация путей норм

**Files:**
- Create: `apps/web/src/lib/legal/corpus.ts`
- Test: `apps/web/tests/legal-corpus.test.ts`

**Interfaces:**
- Produces:
  - `LEGAL_EMBEDDING_DIM = 1536`
  - `buildNormPath(articleNumber: string, paragraphNumber?: string | null): string`
  - `buildFtsInput(title: string, text: string): string`

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-corpus.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { LEGAL_EMBEDDING_DIM, buildNormPath, buildFtsInput } from '../src/lib/legal/corpus'

describe('legal corpus helpers', () => {
  it('фиксирует размерность эмбеддинга', () => {
    expect(LEGAL_EMBEDDING_DIM).toBe(1536)
  })

  it('строит путь нормы со статьёй и пунктом', () => {
    expect(buildNormPath('454', '1')).toBe('ст. 454 п. 1')
  })

  it('строит путь нормы без пункта', () => {
    expect(buildNormPath('454', null)).toBe('ст. 454')
  })

  it('склеивает заголовок и текст для FTS с одним пробелом', () => {
    expect(buildFtsInput('Договор', 'купли-продажи')).toBe('Договор купли-продажи')
    expect(buildFtsInput('', 'только текст')).toBe('только текст')
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-corpus.test.ts`
Expected: FAIL (модуль `corpus` не найден).

- [ ] **Step 3: Реализовать `corpus.ts`**

```ts
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-corpus.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/legal/corpus.ts apps/web/tests/legal-corpus.test.ts
git commit -m "Юрбаза: константы корпуса и нормализация путей норм"
```

---

### Task 3: Маппинг типов договоров → акты

**Files:**
- Create: `apps/web/src/lib/legal/contract-types.ts`
- Test: `apps/web/tests/legal-contract-types.test.ts`

**Interfaces:**
- Produces:
  - `type ContractType` (строковый union)
  - `CONTRACT_TYPE_ACTS: Record<ContractType, string[]>` — shortName актов, по убыванию приоритета
  - `actsForContractType(type: string | null | undefined): string[]` — всегда включает ГК РФ; неизвестный тип → только базовые (`['ГК РФ']`)

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-contract-types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { actsForContractType, CONTRACT_TYPE_ACTS } from '../src/lib/legal/contract-types'

describe('actsForContractType', () => {
  it('трудовой договор тянет ТК и ГК', () => {
    const acts = actsForContractType('employment')
    expect(acts).toContain('ТК РФ')
    expect(acts).toContain('ГК РФ')
  })

  it('поставка тянет ГК', () => {
    expect(actsForContractType('supply')).toContain('ГК РФ')
  })

  it('неизвестный тип → базовый ГК', () => {
    expect(actsForContractType('нечто-неизвестное')).toEqual(['ГК РФ'])
  })

  it('пустой тип → базовый ГК', () => {
    expect(actsForContractType(null)).toEqual(['ГК РФ'])
    expect(actsForContractType(undefined)).toEqual(['ГК РФ'])
  })

  it('каждый маппинг включает ГК РФ', () => {
    for (const acts of Object.values(CONTRACT_TYPE_ACTS)) {
      expect(acts).toContain('ГК РФ')
    }
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-contract-types.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `contract-types.ts`**

```ts
// Маппинг «тип договора → релевантные акты (shortName)». Пред-фильтр для ретривера.
// ГК РФ входит всегда — это база любого договора.

export type ContractType =
  | 'supply'        // поставка
  | 'services'      // возмездное оказание услуг
  | 'work'          // подряд
  | 'lease'         // аренда
  | 'sale'          // купля-продажа
  | 'loan'          // заём
  | 'employment'    // трудовой
  | 'gph'           // ГПХ с физлицом/самозанятым
  | 'agency'        // агентский/поручение/комиссия
  | 'ip_license'    // лицензия/ИС
  | 'consumer'      // с потребителем
  | 'procurement'   // госзакупки

export const CONTRACT_TYPE_ACTS: Record<ContractType, string[]> = {
  supply:      ['ГК РФ'],
  services:    ['ГК РФ'],
  work:        ['ГК РФ'],
  lease:       ['ГК РФ'],
  sale:        ['ГК РФ'],
  loan:        ['ГК РФ'],
  employment:  ['ТК РФ', 'ГК РФ'],
  gph:         ['ГК РФ', '422-ФЗ'],
  agency:      ['ГК РФ'],
  ip_license:  ['ГК РФ'],
  consumer:    ['ЗоЗПП', 'ГК РФ'],
  procurement: ['44-ФЗ', '223-ФЗ', 'ГК РФ'],
}

const BASE_ACTS = ['ГК РФ']

/** Акты для типа договора. Неизвестный/пустой тип → только базовые. */
export function actsForContractType(type: string | null | undefined): string[] {
  if (!type) return [...BASE_ACTS]
  const mapped = CONTRACT_TYPE_ACTS[type as ContractType]
  return mapped ? [...mapped] : [...BASE_ACTS]
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-contract-types.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/legal/contract-types.ts apps/web/tests/legal-contract-types.test.ts
git commit -m "Юрбаза: маппинг типов договоров на акты"
```

---

### Task 4: Гибридное ре-ранжирование результатов

**Files:**
- Create: `apps/web/src/lib/legal/ranking.ts`
- Test: `apps/web/tests/legal-ranking.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `interface ScoredNorm { normId: string; score: number }`
  - `mergeRankings(fts: ScoredNorm[], vector: ScoredNorm[], opts?: { ftsWeight?: number; vectorWeight?: number; topK?: number }): ScoredNorm[]` — нормализует оценки каждого списка в [0,1], складывает с весами (по умолчанию 0.5/0.5), сортирует по убыванию, режет до `topK` (по умолчанию 8). Дубликаты нормы объединяются суммой взвешенных оценок.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-ranking.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mergeRankings } from '../src/lib/legal/ranking'

describe('mergeRankings', () => {
  it('норма, найденная обоими методами, обходит найденную одним', () => {
    const fts = [{ normId: 'a', score: 10 }, { normId: 'b', score: 5 }]
    const vector = [{ normId: 'a', score: 0.9 }, { normId: 'c', score: 0.8 }]
    const merged = mergeRankings(fts, vector)
    expect(merged[0].normId).toBe('a')
  })

  it('нормализует разные шкалы (FTS в десятках, вектор в долях)', () => {
    const fts = [{ normId: 'a', score: 100 }]
    const vector = [{ normId: 'b', score: 0.99 }]
    const merged = mergeRankings(fts, vector, { ftsWeight: 0.5, vectorWeight: 0.5 })
    // оба — единственные лидеры своих списков → нормализуются в 1 → равный вес
    expect(merged.find((m) => m.normId === 'a')!.score).toBeCloseTo(0.5)
    expect(merged.find((m) => m.normId === 'b')!.score).toBeCloseTo(0.5)
  })

  it('режет до topK', () => {
    const fts = [
      { normId: 'a', score: 5 }, { normId: 'b', score: 4 },
      { normId: 'c', score: 3 }, { normId: 'd', score: 2 },
    ]
    expect(mergeRankings(fts, [], { topK: 2 })).toHaveLength(2)
  })

  it('пустые входы → пустой выход', () => {
    expect(mergeRankings([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-ranking.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `ranking.ts`**

```ts
// Слияние результатов двух методов поиска (полнотекст + вектор) в один рейтинг.

export interface ScoredNorm {
  normId: string
  score: number
}

interface MergeOpts {
  ftsWeight?: number
  vectorWeight?: number
  topK?: number
}

/** min-max нормализация оценок списка в [0,1]. Если все равны — все получают 1. */
function normalize(list: ScoredNorm[]): Map<string, number> {
  const out = new Map<string, number>()
  if (list.length === 0) return out
  const scores = list.map((s) => s.score)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const span = max - min
  for (const item of list) {
    out.set(item.normId, span === 0 ? 1 : (item.score - min) / span)
  }
  return out
}

export function mergeRankings(
  fts: ScoredNorm[],
  vector: ScoredNorm[],
  opts: MergeOpts = {},
): ScoredNorm[] {
  const ftsWeight = opts.ftsWeight ?? 0.5
  const vectorWeight = opts.vectorWeight ?? 0.5
  const topK = opts.topK ?? 8

  const ftsNorm = normalize(fts)
  const vectorNorm = normalize(vector)

  const combined = new Map<string, number>()
  for (const [id, s] of ftsNorm) {
    combined.set(id, (combined.get(id) ?? 0) + s * ftsWeight)
  }
  for (const [id, s] of vectorNorm) {
    combined.set(id, (combined.get(id) ?? 0) + s * vectorWeight)
  }

  return [...combined.entries()]
    .map(([normId, score]) => ({ normId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-ranking.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/legal/ranking.ts apps/web/tests/legal-ranking.test.ts
git commit -m "Юрбаза: гибридное ре-ранжирование норм"
```

---

### Task 5: Интерфейс эмбеддера + детерминированный мок

**Files:**
- Create: `apps/web/src/lib/legal/embeddings.ts`
- Test: `apps/web/tests/legal-embeddings.test.ts`

**Interfaces:**
- Consumes: `LEGAL_EMBEDDING_DIM` из `corpus.ts`.
- Produces:
  - `interface EmbeddingClient { embed(texts: string[]): Promise<number[][]> }`
  - `hashEmbedder: EmbeddingClient` — детерминированный локальный эмбеддер (хеш-бэг слов в вектор фикс. длины, L2-нормализован). Для тестов и как fallback без оператора.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-embeddings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashEmbedder } from '../src/lib/legal/embeddings'
import { LEGAL_EMBEDDING_DIM } from '../src/lib/legal/corpus'

describe('hashEmbedder', () => {
  it('возвращает вектор фиксированной длины на каждый вход', async () => {
    const [v] = await hashEmbedder.embed(['договор поставки'])
    expect(v).toHaveLength(LEGAL_EMBEDDING_DIM)
  })

  it('детерминирован: один текст → один вектор', async () => {
    const [a] = await hashEmbedder.embed(['неустойка'])
    const [b] = await hashEmbedder.embed(['неустойка'])
    expect(a).toEqual(b)
  })

  it('похожие тексты ближе, чем непохожие (косинус)', async () => {
    const [a, b, c] = await hashEmbedder.embed([
      'ответственность сторон неустойка',
      'неустойка ответственность сторон',
      'банковские реквизиты счёт',
    ])
    const cos = (x: number[], y: number[]) => x.reduce((s, xi, i) => s + xi * y[i], 0)
    expect(cos(a, b)).toBeGreaterThan(cos(a, c))
  })

  it('L2-норма ≈ 1', async () => {
    const [v] = await hashEmbedder.embed(['аренда'])
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-embeddings.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `embeddings.ts`**

```ts
// Абстракция эмбеддера. hashEmbedder — детерминированный локальный вектор
// (без сети): для тестов и как fallback, если эмбеддинг-оператор не настроен.
// Реальный эмбеддер оператора добавляется в Плане 3 (задача `embed` в lib/ai).

import { LEGAL_EMBEDDING_DIM } from './corpus'

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

/** FNV-1a хеш слова → индекс корзины. */
function bucket(word: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return Math.abs(h) % LEGAL_EMBEDDING_DIM
}

function embedOne(text: string): number[] {
  const vec = new Array(LEGAL_EMBEDDING_DIM).fill(0)
  const words = text.toLowerCase().split(/[^a-zа-я0-9ё]+/i).filter(Boolean)
  for (const w of words) vec[bucket(w)] += 1
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1
  return vec.map((x) => x / norm)
}

export const hashEmbedder: EmbeddingClient = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(embedOne)
  },
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-embeddings.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/legal/embeddings.ts apps/web/tests/legal-embeddings.test.ts
git commit -m "Юрбаза: интерфейс эмбеддера и детерминированный мок"
```

---

### Task 6: Ретривер `retrieveNorms` (гибрид FTS + вектор)

**Files:**
- Create: `apps/web/src/lib/legal/retrieval.ts`
- Test: `apps/web/tests/legal-retrieval.test.ts`

**Interfaces:**
- Consumes: `mergeRankings`/`ScoredNorm` (ranking.ts), `EmbeddingClient` (embeddings.ts), `actsForContractType` (contract-types.ts), `LEGAL_EMBEDDING_DIM` (corpus.ts).
- Produces:
  - `interface RetrievedNorm { normId: string; actShortName: string; path: string; title: string; text: string; officialUrl: string | null; score: number }`
  - `interface RetrieveDeps { queryRows: (sql: string, params: unknown[]) => Promise<NormRow[]>; embedder: EmbeddingClient }`
  - `interface NormRow { id: string; actShortName: string; path: string; title: string; text: string; officialUrl: string | null; rank: number }`
  - `retrieveNorms(input: { contractType?: string | null; queryText: string; topK?: number }, deps: RetrieveDeps): Promise<RetrievedNorm[]>`

Поведение: строит пред-фильтр по `actsForContractType`; выполняет два запроса через `deps.queryRows` — FTS (`plainto_tsquery('russian', $q)`) и векторный (`embedding <=> $vec`); сливает через `mergeRankings`; возвращает топ-K с метаданными из строк. Если `deps.embedder.embed` бросает или возвращает пустое — работает только на FTS (graceful fallback). Пустой `queryText` → `[]`.

- [ ] **Step 1: Написать падающий тест**

`apps/web/tests/legal-retrieval.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { retrieveNorms } from '../src/lib/legal/retrieval'
import { hashEmbedder } from '../src/lib/legal/embeddings'

function fakeRows(kind: 'fts' | 'vector') {
  // FTS находит норму про неустойку; вектор — про ответственность
  if (kind === 'fts') {
    return [
      { id: 'n1', actShortName: 'ГК РФ', path: 'ст. 330', title: 'Неустойка', text: '...', officialUrl: null, rank: 0.9 },
    ]
  }
  return [
    { id: 'n1', actShortName: 'ГК РФ', path: 'ст. 330', title: 'Неустойка', text: '...', officialUrl: null, rank: 0.7 },
    { id: 'n2', actShortName: 'ГК РФ', path: 'ст. 401', title: 'Основания ответственности', text: '...', officialUrl: null, rank: 0.6 },
  ]
}

describe('retrieveNorms', () => {
  it('сливает FTS и вектор, норма из обоих — первой', async () => {
    const queryRows = vi.fn(async (sql: string) =>
      sql.includes('<=>') ? fakeRows('vector') : fakeRows('fts'),
    )
    const res = await retrieveNorms(
      { contractType: 'supply', queryText: 'неустойка ответственность' },
      { queryRows, embedder: hashEmbedder },
    )
    expect(res[0].normId).toBe('n1')
    expect(res.map((r) => r.normId)).toContain('n2')
    // два запроса: FTS и векторный
    expect(queryRows).toHaveBeenCalledTimes(2)
  })

  it('пустой queryText → пустой результат без запросов', async () => {
    const queryRows = vi.fn(async () => [])
    const res = await retrieveNorms(
      { queryText: '   ' },
      { queryRows, embedder: hashEmbedder },
    )
    expect(res).toEqual([])
    expect(queryRows).not.toHaveBeenCalled()
  })

  it('падение эмбеддера → работает только на FTS', async () => {
    const queryRows = vi.fn(async () => fakeRows('fts'))
    const brokenEmbedder = { embed: async () => { throw new Error('нет оператора') } }
    const res = await retrieveNorms(
      { queryText: 'неустойка' },
      { queryRows, embedder: brokenEmbedder },
    )
    expect(res).toHaveLength(1)
    expect(res[0].normId).toBe('n1')
    // только FTS-запрос
    expect(queryRows).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd apps/web && npx vitest run tests/legal-retrieval.test.ts`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать `retrieval.ts`**

```ts
// Гибридный ретривер норм: полнотекст (FTS) + вектор (pgvector), слияние ре-ранком.
// SQL выполняется через внедряемый queryRows (в проде — обёртка над prisma.$queryRawUnsafe),
// чтобы модуль тестировался без живой БД.

import { mergeRankings, type ScoredNorm } from './ranking'
import { actsForContractType } from './contract-types'
import type { EmbeddingClient } from './embeddings'

export interface NormRow {
  id: string
  actShortName: string
  path: string
  title: string
  text: string
  officialUrl: string | null
  rank: number
}

export interface RetrievedNorm {
  normId: string
  actShortName: string
  path: string
  title: string
  text: string
  officialUrl: string | null
  score: number
}

export interface RetrieveDeps {
  queryRows: (sql: string, params: unknown[]) => Promise<NormRow[]>
  embedder: EmbeddingClient
}

const FTS_SQL = `
  SELECT n.id, a."shortName" AS "actShortName", n.path, n.title, n.text,
         a."officialUrl" AS "officialUrl",
         ts_rank(n.fts, plainto_tsquery('russian', $1)) AS rank
  FROM legal_norms n
  JOIN legal_act_editions e ON e.id = n."editionId" AND e."isCurrent" = true
  JOIN legal_acts a ON a.id = e."actId"
  WHERE n.fts @@ plainto_tsquery('russian', $1)
    AND ($2::text[] IS NULL OR a."shortName" = ANY($2::text[]))
  ORDER BY rank DESC
  LIMIT $3
`

const VECTOR_SQL = `
  SELECT n.id, a."shortName" AS "actShortName", n.path, n.title, n.text,
         a."officialUrl" AS "officialUrl",
         1 - (n.embedding <=> $1::vector) AS rank
  FROM legal_norms n
  JOIN legal_act_editions e ON e.id = n."editionId" AND e."isCurrent" = true
  JOIN legal_acts a ON a.id = e."actId"
  WHERE n.embedding IS NOT NULL
    AND ($2::text[] IS NULL OR a."shortName" = ANY($2::text[]))
  ORDER BY n.embedding <=> $1::vector
  LIMIT $3
`

function toScored(rows: NormRow[]): ScoredNorm[] {
  return rows.map((r) => ({ normId: r.id, score: r.rank }))
}

export async function retrieveNorms(
  input: { contractType?: string | null; queryText: string; topK?: number },
  deps: RetrieveDeps,
): Promise<RetrievedNorm[]> {
  const query = input.queryText.trim()
  if (!query) return []

  const topK = input.topK ?? 8
  const perMethod = topK * 3
  // null → без пред-фильтра по акту; иначе массив shortName
  const acts = input.contractType ? actsForContractType(input.contractType) : null

  const ftsRows = await deps.queryRows(FTS_SQL, [query, acts, perMethod])

  let vectorRows: NormRow[] = []
  try {
    const [vec] = await deps.embedder.embed([query])
    if (vec && vec.length > 0) {
      const vecLiteral = `[${vec.join(',')}]`
      vectorRows = await deps.queryRows(VECTOR_SQL, [vecLiteral, acts, perMethod])
    }
  } catch {
    // эмбеддинг-оператор недоступен — деградируем до FTS-only
    vectorRows = []
  }

  const merged = mergeRankings(toScored(ftsRows), toScored(vectorRows), { topK })

  const byId = new Map<string, NormRow>()
  for (const r of [...ftsRows, ...vectorRows]) byId.set(r.id, r)

  return merged
    .map((m) => {
      const row = byId.get(m.normId)
      if (!row) return null
      return {
        normId: row.id,
        actShortName: row.actShortName,
        path: row.path,
        title: row.title,
        text: row.text,
        officialUrl: row.officialUrl,
        score: m.score,
      }
    })
    .filter((x): x is RetrievedNorm => x !== null)
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd apps/web && npx vitest run tests/legal-retrieval.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Прогнать весь набор юрбазы и typecheck**

Run:
```bash
cd apps/web && npx vitest run tests/legal-*.test.ts && npx tsc --noEmit
```
Expected: все тесты PASS; typecheck без ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/legal/retrieval.ts apps/web/tests/legal-retrieval.test.ts
git commit -m "Юрбаза: гибридный ретривер норм (FTS + вектор) с fallback"
```

---

## Что дальше (вне этого плана)

- **План 2 — Наполнение и синхронизация:** разведка формата API `publication.pravo.gov.ru`, сидер ядра (~15 актов), воркер `legal-sync` (BullMQ) с append-only редакциями и флагом «ручная проверка». Здесь появится продовая обёртка `queryRows` над `prisma.$queryRawUnsafe` и реальный `EmbeddingClient` оператора.
- **План 3 — Грунтинг и интеграция в ИИ-задачи:** сборка блока «нормативный контекст», маркеры `[[norm:id]]`, постобработка в ссылки; интеграция в `review`/`analyze_upload` (по умолчанию) и `generate` (по запросу); задача `embed` в `lib/ai` (transport `/embeddings`).

## Self-Review (пройден)

- **Покрытие спеки:** данные (§4) → Task 1; извлечение гибрид (§6.1) → Tasks 4/6; пред-фильтр по типу (§6.1) → Task 3; graceful fallback на FTS (§6.1) → Task 6; append-only (§4) → Task 1 (isCurrent, без UPDATE текста). Наполнение (§5) и грунтинг/интеграция (§6.2–6.4) вынесены в Планы 2/3 (осознанное разбиение подсистем).
- **Заглушки:** нет — каждый шаг содержит полный код/SQL/команду.
- **Согласованность типов:** `ScoredNorm`, `NormRow`, `RetrievedNorm`, `EmbeddingClient`, `actsForContractType`, `LEGAL_EMBEDDING_DIM` определены до использования и совпадают по именам между задачами.
