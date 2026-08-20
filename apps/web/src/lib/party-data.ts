// Единый выбор «моей стороны» и подписанта контрагента для документа.
//
// Раньше generate и download выбирали их ПО-РАЗНОМУ:
//  * профиль: generate — Document.profileId → aiSettings.profileId → первый по
//    createdAt; download — Document.profileId → ЛЮБОЙ первый (без orderBy);
//  * подписант: generate — только isDefault:true (нет дефолтного → нет подписанта),
//    download — orderBy isDefault desc (нет дефолтного → любой первый).
// Итог: в тексте договора один подписант, в скачанном DOCX — другой.

import { prisma } from './db'
import type { CounterpartyData, UserProfileData } from './ai/types'

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

/**
 * Полные данные обеих сторон документа в формате UserProfileData/CounterpartyData —
 * единая сборка для генерации, слоя оформления (decor) и выгрузки.
 * signatoryId — явный выбор подписанта контрагента (шаг «Оформление»),
 * иначе дефолтный через resolveCounterpartySignatory.
 */
export async function buildDocumentParties(opts: {
  userId: string
  profileId?: string | null
  fallbackProfileId?: string | null
  counterpartyId: string
  signatoryId?: string | null
}): Promise<{ userProfile: UserProfileData | undefined; counterpartyData: CounterpartyData | undefined; city: string | null }> {
  const profile = await resolveDocumentProfile({
    userId: opts.userId,
    profileId: opts.profileId,
    fallbackProfileId: opts.fallbackProfileId,
  })

  const userProfile: UserProfileData | undefined = profile ? {
    type: profile.type,
    name: profile.name,
    inn: profile.inn,
    kpp: profile.kpp,
    ogrn: profile.ogrn,
    ogrnDate: profile.ogrnDate ?? null,
    legalAddress: profile.legalAddress,
    signatorName: profile.signatorName,
    signatorPosition: profile.signatorPosition,
    // В signatorBasis может лежать и enum-код ('CHARTER'/'POA'), и свободный текст.
    signatorBasis: profile.signatorBasis === 'CHARTER'
      ? 'Устава'
      : profile.signatorBasis === 'POA'
        ? 'Доверенности'
        : profile.signatorBasis,
    bankName: profile.bankDetails[0]?.bankName ?? null,
    checkingAccount: profile.bankDetails[0]?.checkingAccount ?? null,
    bik: profile.bankDetails[0]?.bik ?? null,
    correspondentAccount: profile.bankDetails[0]?.correspondentAccount ?? null,
    email: profile.email ?? null,
    phone: profile.phone ?? null,
    actualAddress: profile.actualAddress ?? null,
    passportSeries: profile.passportSeries ?? null,
    passportNumber: profile.passportNumber ?? null,
    passportIssuedBy: profile.passportIssuedBy ?? null,
    passportIssueDate: profile.passportIssueDate ?? null,
    passportDeptCode: profile.passportDeptCode ?? null,
    npdRegisteredDate: profile.npdRegisteredDate ?? null,
  } as UserProfileData : undefined

  const cp = await prisma.counterparty.findFirst({
    where: { id: opts.counterpartyId, userId: opts.userId },
    include: { bankDetails: { take: 1 } },
  })

  let counterpartyData: CounterpartyData | undefined
  if (cp) {
    const cpSignatory = opts.signatoryId
      ? await prisma.signatory.findFirst({ where: { id: opts.signatoryId, counterpartyId: cp.id } })
      : await resolveCounterpartySignatory(cp.id)
    counterpartyData = {
      type: cp.type,
      name: cp.name,
      inn: cp.inn,
      kpp: cp.kpp,
      ogrn: cp.ogrn,
      legalAddress: cp.legalAddress,
      actualAddress: cp.actualAddress,
      passportSeries: cp.passportSeries,
      passportNumber: cp.passportNumber,
      passportIssuedBy: cp.passportIssuedBy,
      passportIssueDate: cp.passportIssueDate,
      passportDeptCode: cp.passportDeptCode,
      npdRegisteredDate: cp.npdRegisteredDate,
      email: cp.email,
      phone: cp.phone,
      bankName: cp.bankDetails[0]?.bankName ?? null,
      checkingAccount: cp.bankDetails[0]?.checkingAccount ?? null,
      bik: cp.bankDetails[0]?.bik ?? null,
      correspondentAccount: cp.bankDetails[0]?.correspondentAccount ?? null,
      signatorName: cpSignatory?.fullName ?? null,
      signatorPosition: cpSignatory?.position ?? null,
      signatorBasis: cpSignatory
        ? (cpSignatory.basisType === 'CHARTER'
            ? 'Устава'
            : cpSignatory.poaNumber
              ? `Доверенности № ${cpSignatory.poaNumber}`
              : 'Доверенности')
        : null,
    } as CounterpartyData
  }

  // Город договора — из юридического адреса профиля (как в генерации)
  const city = profile?.legalAddress
    ? (profile.legalAddress.match(/(?:г\.|город)\s+([А-Яа-яЁё-]+)/i)?.[1] ?? null)
    : null

  return { userProfile, counterpartyData, city }
}
