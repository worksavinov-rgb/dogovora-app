// Готовит контент версии к показу и выгрузке:
//  1) структурирование загруженного документа (заголовки) — тяжёлое, с ИИ, кэшируется;
//  2) подстановка эталонных шапки и реквизитов из ЛК — дешёвая, выполняется всегда,
//     поэтому изменения реквизитов в ЛК подхватываются сразу, без инвалидации кэша.
//
// Принцип: ИИ/эвристики только НАХОДЯТ границы блоков, а сами реквизиты подставляет
// код из структурированных данных ЛК — в цифрах ИНН и счетов ошибок быть не должно.

import { prisma } from './db'
import {
  buildContractPreambleHtml,
  buildChildDocPreambleHtml,
  buildRequisitesHtml,
  replaceDocumentPreamble,
  replaceRequisitesSection,
} from './html-document'
import { getStructuredContentCached, looksLikeUpload } from './structure-uploaded'
import { logger } from './logger'

type PartyRoles = { role1: string; role2: string }

function rolesFor(userRole: string | undefined): PartyRoles {
  return String(userRole ?? '').toLowerCase() === 'executor'
    ? { role1: 'Исполнитель', role2: 'Заказчик' }
    : { role1: 'Заказчик', role2: 'Исполнитель' }
}

function basisFrom(basisType: string | null, poaNumber: string | null): string | null {
  if (!basisType) return null
  if (basisType === 'CHARTER') return 'Устава'
  if (basisType === 'POA') return poaNumber ? `Доверенности № ${poaNumber}` : 'Доверенности'
  if (basisType === 'CERTIFICATE') return 'Свидетельства о государственной регистрации'
  if (basisType === 'REGULATION') return 'Положения'
  return null
}

/**
 * Эталонные блоки документа: сохранённые в мастере или собранные из ЛК.
 * Возвращает также данные контрагента — для сверки сторон перед подстановкой.
 */
async function getReferenceBlocks(documentId: string, userRole?: string) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      counterparty: { include: { bankDetails: { take: 1 }, signatories: { where: { isDefault: true }, take: 1 } } },
      profile: { include: { bankDetails: { take: 1 } } },
      parentDocument: { select: { title: true, number: true } },
    },
  })
  if (!doc) return null

  const { role1, role2 } = rolesFor(userRole)
  const profile = doc.profile
  const cp = doc.counterparty
  const cpSig = cp?.signatories?.[0]

  const userProfile = profile ? {
    type: profile.type,
    name: profile.name,
    inn: profile.inn,
    kpp: profile.kpp,
    ogrn: profile.ogrn,
    ogrnDate: null,
    legalAddress: profile.legalAddress,
    signatorName: profile.signatorName,
    signatorPosition: profile.signatorPosition,
    signatorBasis: profile.signatorBasis,
    bankName: profile.bankDetails[0]?.bankName ?? null,
    checkingAccount: profile.bankDetails[0]?.checkingAccount ?? null,
    bik: profile.bankDetails[0]?.bik ?? null,
    correspondentAccount: profile.bankDetails[0]?.correspondentAccount ?? null,
    email: null,
  } : null

  const counterpartyData = cp ? {
    name: cp.name,
    inn: cp.inn,
    kpp: cp.kpp,
    ogrn: cp.ogrn,
    legalAddress: cp.legalAddress,
    email: cp.email,
    phone: cp.phone,
    bankName: cp.bankDetails[0]?.bankName ?? null,
    checkingAccount: cp.bankDetails[0]?.checkingAccount ?? null,
    bik: cp.bankDetails[0]?.bik ?? null,
    correspondentAccount: cp.bankDetails[0]?.correspondentAccount ?? null,
    signatorName: cpSig?.fullName ?? null,
    signatorPosition: cpSig?.position ?? null,
    signatorBasis: basisFrom(cpSig?.basisType ?? null, cpSig?.poaNumber ?? null),
  } : null

  // Сохранённые в мастере блоки имеют приоритет (пользователь мог их поправить).
  let preambleHtml = doc.preambleHtml ?? null
  let requisitesHtml = doc.requisitesHtml ?? null

  if (userProfile && counterpartyData) {
    if (!preambleHtml) {
      preambleHtml = doc.type === 'CONTRACT'
        ? buildContractPreambleHtml(userProfile, counterpartyData, role1, role2, undefined,
            doc.signingDate ? doc.signingDate.toISOString() : undefined)
        : buildChildDocPreambleHtml(userProfile, counterpartyData, role1, role2, doc.type,
            doc.documentNumber ?? undefined, doc.parentDocument?.number ?? undefined,
            doc.parentDocument?.title ?? undefined, undefined,
            doc.signingDate ? doc.signingDate.toISOString() : undefined)
    }
    if (!requisitesHtml) {
      requisitesHtml = buildRequisitesHtml(userProfile, counterpartyData, role1, role2)
    }
  }

  return { preambleHtml, requisitesHtml, counterpartyName: cp?.name ?? null, counterpartyInn: cp?.inn ?? null }
}

/** Совпадает ли сторона в документе с контрагентом из ЛК (защита от подмены чужих реквизитов). */
function partyMatches(html: string, name: string | null, inn: string | null): boolean {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  if (inn && text.includes(inn)) return true
  if (name) {
    // Сравниваем по значимой части названия (без кавычек и юр-формы)
    const core = name.replace(/[«»"']/g, ' ').replace(/^(ООО|АО|ПАО|ЗАО|АНО|ИП)\s+/i, '').trim()
    if (core.length >= 4 && text.toLowerCase().includes(core.toLowerCase())) return true
  }
  return false
}

/**
 * Контент версии для предпросмотра и выгрузки: структурирован + с эталонными
 * шапкой и реквизитами из ЛК (для загруженных документов).
 */
export async function getPresentationContent(
  versionId: string,
  documentId: string,
  content: string | null,
  userId: string,
  userRole?: string,
): Promise<string> {
  const structured = await getStructuredContentCached(versionId, content, userId)
  // Сгенерированные документы уже содержат системные блоки — подстановка не нужна.
  if (!looksLikeUpload(content ?? '')) return structured

  try {
    const ref = await getReferenceBlocks(documentId, userRole)
    if (!ref) return structured

    // Предохранитель: в документе должна фигурировать та же сторона, что в ЛК,
    // иначе подставили бы реквизиты другой компании.
    if (!partyMatches(structured, ref.counterpartyName, ref.counterpartyInn)) {
      logger.error({ event: 'presentation.party_mismatch', document_id: documentId, user_id: userId })
      return structured
    }

    let out = structured
    if (ref.preambleHtml) out = replaceDocumentPreamble(out, ref.preambleHtml).html
    if (ref.requisitesHtml) out = replaceRequisitesSection(out, ref.requisitesHtml).html

    // Проверка целостности: подстановка не должна «съесть» документ.
    const before = structured.replace(/<[^>]+>/g, '').length
    const after = out.replace(/<[^>]+>/g, '').length
    if (after < before * 0.8) {
      logger.error({ event: 'presentation.integrity_guard', document_id: documentId, before, after })
      return structured
    }
    return out
  } catch (err) {
    logger.error({ event: 'presentation.substitution_failed', error: err, document_id: documentId })
    return structured
  }
}
