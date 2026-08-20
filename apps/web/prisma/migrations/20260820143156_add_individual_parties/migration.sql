-- Физлица и самозанятые как стороны договора.
-- Только аддитивные изменения: новое значение enum, новые колонки, backfill типа.

-- AlterEnum: новый тип стороны «Самозанятый».
-- Значение не используется в этой же миграции (backfill опирается на существующие
-- COMPANY/SOLE_PROPRIETOR), поэтому безопасно в одной транзакции (PG 12+).
ALTER TYPE "ProfileType" ADD VALUE 'SELF_EMPLOYED';

-- AlterTable: паспортные/контактные поля профиля (все необязательны).
ALTER TABLE "profiles"
  ADD COLUMN "actualAddress" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "passportSeries" TEXT,
  ADD COLUMN "passportNumber" TEXT,
  ADD COLUMN "passportIssuedBy" TEXT,
  ADD COLUMN "passportIssueDate" TEXT,
  ADD COLUMN "passportDeptCode" TEXT,
  ADD COLUMN "npdRegisteredDate" TEXT;

-- AlterTable: тип контрагента + паспортные поля.
ALTER TABLE "counterparties"
  ADD COLUMN "type" "ProfileType" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "actualAddress" TEXT,
  ADD COLUMN "passportSeries" TEXT,
  ADD COLUMN "passportNumber" TEXT,
  ADD COLUMN "passportIssuedBy" TEXT,
  ADD COLUMN "passportIssueDate" TEXT,
  ADD COLUMN "passportDeptCode" TEXT,
  ADD COLUMN "npdRegisteredDate" TEXT;

-- Backfill: существующим контрагентам ставим тип по эвристике «есть КПП → ООО».
UPDATE "counterparties"
SET "type" = CASE
  WHEN "kpp" IS NOT NULL AND "kpp" <> '' THEN 'COMPANY'::"ProfileType"
  ELSE 'SOLE_PROPRIETOR'::"ProfileType"
END;
