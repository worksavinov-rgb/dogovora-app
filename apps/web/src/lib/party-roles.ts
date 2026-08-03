// Единый источник истины: какую роль (Заказчик/Исполнитель) играет пользователь
// в договоре. Раньше эта логика была продублирована в download/route.ts и в
// предпросмотре (versions/[id]/route.ts) с РАЗНЫМ поведением для пустого значения:
// скачивание падало в EXECUTOR, а предпросмотр — в CUSTOMER, из-за чего в
// загруженных документах стороны в шапке и реквизитах вставали местами.
//
// Теперь оба пути зовут resolvePartyRole → результат гарантированно одинаковый.

import { prisma } from './db'

export type PartyRole = 'CUSTOMER' | 'EXECUTOR'

/**
 * Роль пользователя из настроек версии, без запросов к БД.
 * Источники (по приоритету): aiSettings.userRole → текст customInstruction.
 * Возвращает null, если однозначно определить нельзя.
 */
export function roleFromAiSettings(ai: unknown): PartyRole | null {
  if (!ai || typeof ai !== 'object') return null
  const a = ai as { userRole?: string; customInstruction?: string }
  const raw = (a.userRole ?? '').toString().toLowerCase()
  if (raw === 'customer' || raw === 'executor') return raw.toUpperCase() as PartyRole
  const instr = a.customInstruction ?? ''
  if (/заказчик/i.test(instr)) return 'CUSTOMER'
  if (/исполнител/i.test(instr)) return 'EXECUTOR'
  return null
}

/**
 * Итоговая роль пользователя с учётом наследования от родительского договора
 * (для приложений/допсоглашений) и запасного значения по умолчанию.
 * ВАЖНО: значение по умолчанию (EXECUTOR) должно совпадать во всех местах —
 * иначе предпросмотр и выгрузка снова разойдутся.
 */
export async function resolvePartyRole(params: {
  aiSettings: unknown
  parentDocumentId: string | null
  userId: string
}): Promise<PartyRole> {
  let role = roleFromAiSettings(params.aiSettings)
  if (!role && params.parentDocumentId) {
    const parentVersion = await prisma.version.findFirst({
      where: { document: { id: params.parentDocumentId, userId: params.userId } },
      orderBy: { number: 'desc' },
      select: { aiSettings: true },
    })
    role = roleFromAiSettings(parentVersion?.aiSettings)
  }
  return role ?? 'EXECUTOR'
}

/** Формат, который ждут getPresentationContent / buildRequisitesHtml. */
export function toLowerRole(role: PartyRole): 'customer' | 'executor' {
  return role === 'CUSTOMER' ? 'customer' : 'executor'
}
