-- Исправления по итогам независимой проверки, до наполнения корпуса.

-- I5: «текущая редакция» должна быть ровно одна на акт.
-- Без этого две редакции с isCurrent=true дают дубли норм в выдаче ретривера,
-- дубли съедают topK и попадают в промпт ИИ.
CREATE UNIQUE INDEX "legal_act_editions_one_current_per_act"
  ON "legal_act_editions"("actId") WHERE "isCurrent";

-- I6: журнал алертов append-only — удаление отслеживаемого акта не должно
-- стирать историю найденных поправок. Деактивация делается через isActive.
ALTER TABLE "legal_change_alerts" DROP CONSTRAINT "legal_change_alerts_trackedActId_fkey";
ALTER TABLE "legal_change_alerts"
  ADD CONSTRAINT "legal_change_alerts_trackedActId_fkey"
  FOREIGN KEY ("trackedActId") REFERENCES "legal_tracked_acts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- I7: ivfflat, построенный на пустой таблице, даёт низкую полноту — Postgres
-- предупреждает об этом прямо при создании. Индекс строится скриптом ПОСЛЕ
-- загрузки норм (scripts/legal/build-vector-index.ts), здесь его убираем.
DROP INDEX IF EXISTS "legal_norms_embedding_idx";
