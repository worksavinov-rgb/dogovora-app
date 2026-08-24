-- Мониторинг изменений законодательства: отслеживаемые акты и найденные поправки.

CREATE TYPE "LegalAlertStatus" AS ENUM ('NEW', 'REVIEWED', 'APPLIED');

CREATE TABLE "legal_tracked_acts" (
  "id" TEXT NOT NULL,
  "actId" TEXT,
  "shortName" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "matchTerms" TEXT[],
  "lastCheckedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_tracked_acts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_tracked_acts_shortName_key" ON "legal_tracked_acts"("shortName");

CREATE TABLE "legal_change_alerts" (
  "id" TEXT NOT NULL,
  "trackedActId" TEXT NOT NULL,
  "eoNumber" TEXT NOT NULL,
  "complexName" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL,
  "matchedTerm" TEXT NOT NULL,
  "hasText" BOOLEAN NOT NULL DEFAULT false,
  "status" "LegalAlertStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_change_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_change_alerts_trackedActId_eoNumber_key"
  ON "legal_change_alerts"("trackedActId", "eoNumber");
CREATE INDEX "legal_change_alerts_status_createdAt_idx"
  ON "legal_change_alerts"("status", "createdAt");
ALTER TABLE "legal_change_alerts"
  ADD CONSTRAINT "legal_change_alerts_trackedActId_fkey"
  FOREIGN KEY ("trackedActId") REFERENCES "legal_tracked_acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
