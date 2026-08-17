// Единый выбор «моей стороны» и подписанта контрагента для документа.
//
// Раньше generate и download выбирали их ПО-РАЗНОМУ:
//  * профиль: generate — Document.profileId → aiSettings.profileId → первый по
//    createdAt; download — Document.profileId → ЛЮБОЙ первый (без orderBy);
//  * подписант: generate — только isDefault:true (нет дефолтного → нет подписанта),
//    download — orderBy isDefault desc (нет дефолтного → любой первый).
// Итог: в тексте договора один подписант, в скачанном DOCX — другой.

import { prisma } from './db'

/**
 * Профиль пользователя для документа: явно выбранный на документе, иначе
 * запасной из aiSettings (старые документы), иначе первый созданный.
 */
export async function resolveDocumentProfile(params: {
  userId: string
  profileId?: string | null
  fallbackProfileId?: string | null
}) {
  const { userId, profileId, fallbackProfileId } = params
  return prisma.profile.findFirst({
    where: {
      userId,
      ...(profileId ? { id: profileId } : fallbackProfileId ? { id: fallbackProfileId } : {}),
    },
    include: { bankDetails: { take: 1 } },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * Подписант контрагента: дефолтный, а если дефолтный не назначен — первый
 * созданный (лучше показать хоть какого-то подписанта, чем пустые прочерки;
 * такое же поведение было у download).
 */
export async function resolveCounterpartySignatory(counterpartyId: string) {
  return prisma.signatory.findFirst({
    where: { counterpartyId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
}
