-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('RUB', 'TOKEN');

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('GENERATE', 'UPLOAD_EDIT_START', 'REWRITE', 'EDIT_PACKAGE', 'REVIEW', 'ANALYZE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "aiEditsUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'TOKEN';

-- CreateTable
CREATE TABLE "version_drafts" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "baseVersionId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "version_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_charges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT,
    "versionId" TEXT,
    "kind" "ChargeKind" NOT NULL,
    "tokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "token_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "version_drafts_documentId_key" ON "version_drafts"("documentId");

-- CreateIndex
CREATE INDEX "token_charges_documentId_idx" ON "token_charges"("documentId");

-- CreateIndex
CREATE INDEX "token_charges_userId_createdAt_idx" ON "token_charges"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "version_drafts" ADD CONSTRAINT "version_drafts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Миграция данных: переход на токены ──────────────────────────────────────

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
