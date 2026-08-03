-- Шапка и блок реквизитов/подписей, согласованные пользователем при создании
-- документа (мастер строит их из ЛК и разрешает править вручную).
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "preambleHtml" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "requisitesHtml" TEXT;
