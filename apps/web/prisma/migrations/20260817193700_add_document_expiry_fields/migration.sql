-- Сроки действия договора для напоминаний об истечении и автопролонгации:
--  * expiresAt — дата окончания срока действия
--  * autoRenewal — продлевается ли договор автоматически
--  * renewalNoticeDays — за сколько дней нужно заявить об отказе от пролонгации
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "autoRenewal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "renewalNoticeDays" INTEGER;
