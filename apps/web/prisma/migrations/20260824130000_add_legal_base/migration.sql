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
