-- Согласия пользователя (152-ФЗ): оферта, ПДн, трансграничная передача, рассылки.
-- Таблица append-only: отзыв согласия пишется новой строкой с granted = false.

DO $$ BEGIN
  CREATE TYPE "ConsentKind" AS ENUM ('OFFER', 'PDN', 'CROSS_BORDER', 'MARKETING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "user_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "docVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'registration',
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_consents_userId_kind_createdAt_idx"
    ON "user_consents"("userId", "kind", "createdAt");

DO $$ BEGIN
  ALTER TABLE "user_consents"
    ADD CONSTRAINT "user_consents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
