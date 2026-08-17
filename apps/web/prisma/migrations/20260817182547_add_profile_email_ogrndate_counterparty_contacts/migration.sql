-- Поля, которые формы собирали всегда, но колонок в БД не было:
--  * profiles."ogrnDate" — «ОГРНИП … от … г.» в преамбуле (форма «Мои реквизиты»)
--  * profiles.email — email в блоке реквизитов документа
--  * counterparties.contacts — контактные лица в карточке контрагента
--    (без колонки PUT /api/counterparties/:id падал с 500)
-- IF NOT EXISTS: часть колонок могла быть добавлена вручную (обнаружен дрейф dev-БД).
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "ogrnDate" TEXT;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "counterparties" ADD COLUMN IF NOT EXISTS "contacts" JSONB;
