-- Приоритет ручной правки над автоматикой в слое «Оформление».
--
-- До этого шапка сохранялась один раз и больше не пересобиралась (поменял номер
-- договора — в шапке оставался старый), а блок реквизитов, наоборот, пересобирался
-- при каждом показе и молча затирал ручные правки. Флаги разводят эти случаи:
-- блок без флага пересобирается всегда, блок с флагом не трогается никогда.
ALTER TABLE "documents" ADD COLUMN "preambleManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN "requisitesManual" BOOLEAN NOT NULL DEFAULT false;

-- Выбор, сделанный на шаге «Оформление». Раньше сохранялся только готовый HTML,
-- поэтому пересобрать блок точно так же было нельзя: терялись город и выбранный
-- подписант (вместо него подставлялся дефолтный).
ALTER TABLE "documents" ADD COLUMN "decorCity" TEXT;
ALTER TABLE "documents" ADD COLUMN "decorSignatoryId" TEXT;
