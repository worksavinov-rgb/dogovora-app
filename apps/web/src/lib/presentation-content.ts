// Готовит контент версии к показу и выгрузке:
//  1) структурирование загруженного документа (заголовки) — тяжёлое, с ИИ, кэшируется;
//  2) подстановка блока реквизитов из ЛК — дешёвая, выполняется всегда, поэтому
//     изменения реквизитов в ЛК подхватываются сразу, без инвалидации кэша.
//
// Принцип: ИИ/эвристики только НАХОДЯТ границы блоков, а сами реквизиты подставляет
// код из структурированных данных ЛК — в цифрах ИНН и счетов ошибок быть не должно.
//
// Шапка загруженного документа — исключение: её мы не подменяем. Пользователь принёс
// готовый договор со своей шапкой, и она остаётся его. Заменить шапку можно только
// явно — согласовав её на шаге «Оформление» (тогда она лежит в Document.preambleHtml).

import { prisma } from './db'
import {
  buildRequisitesHtml,
  replaceDocumentPreamble,
  replaceRequisitesSection,
} from './html-document'
import { hasInlineRequisites } from './html-document'
import { resolveCounterpartySignatory, resolveDocumentProfile } from './party-data'
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
      counterparty: { include: { bankDetails: { take: 1 } } },
      profile: { include: { bankDetails: { take: 1 } } },
    },
  })
  if (!doc) return null

  const { role1, role2 } = rolesFor(userRole)
  // Профиль документа: явно связанный, иначе запасной (как в download/generate) —
  // чтобы у загруженного договора без выбранного юрлица тоже была «моя» сторона,
  // а блок реквизитов подставлялся полностью, а не оставался пустым.
  const profile = doc.profile ?? await resolveDocumentProfile({ userId: doc.userId, profileId: doc.profileId })
  const cp = doc.counterparty
  // Подписант контрагента — через общий резолвер (party-data): дефолтный, а если
  // «по умолчанию» никто не отмечен — первый созданный. Здесь стояло жёсткое
  // isDefault:true, и шапка получала прочерки «в лице ____, действующего на
  // основании ____», хотя подписант в карточке заполнен, — при этом DOCX брал
  // его же через резолвер. Один резолвер = одинаковый подписант везде.
  const cpSig = cp ? await resolveCounterpartySignatory(cp.id) : null

  const userProfile = profile ? {
    type: profile.type,
    name: profile.name,
    inn: profile.inn,
    kpp: profile.kpp,
    ogrn: profile.ogrn,
    ogrnDate: profile.ogrnDate ?? null,
    legalAddress: profile.legalAddress,
    signatorName: profile.signatorName,
    signatorPosition: profile.signatorPosition,
    signatorBasis: profile.signatorBasis,
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
  } : null

  const counterpartyData = cp ? {
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
    signatorName: cpSig?.fullName ?? null,
    signatorPosition: cpSig?.position ?? null,
    signatorBasis: basisFrom(cpSig?.basisType ?? null, cpSig?.poaNumber ?? null),
  } : null

  // Шапка — ТОЛЬКО та, которую пользователь сам согласовал на шаге «Оформление»
  // (Document.preambleHtml). Своей шапки мы больше не собираем: если человек
  // принёс готовый договор со своей шапкой, подменять её нельзя — там могут быть
  // формулировки и стороны, которых в ЛК нет.
  const preambleHtml = doc.preambleHtml ?? null
  // Реквизиты подставляем из АКТУАЛЬНЫХ данных ЛК на КАЖДЫЙ показ — поэтому правки
  // карточки контрагента/профиля отражаются в договоре сразу (ИНН, счета, БИК, адрес,
  // подписант). Сохранённый слой оформления (doc.requisitesHtml) для загруженного
  // договора НЕ имеет приоритета над живыми данными: он мог быть собран, когда
  // карточка контрагента содержала лишь имя+ИНН, и «замораживал» неполные реквизиты
  // (симптом: заполнил карточку → в договоре по-прежнему только «ИП … / ИНН …»).
  // Откатываемся на сохранённый слой только если из ЛК строить нечего.
  const requisitesHtml = (userProfile && counterpartyData)
    ? buildRequisitesHtml(userProfile, counterpartyData, role1, role2)
    : (doc.requisitesHtml ?? null)

  return { preambleHtml, requisitesHtml, counterpartyName: cp?.name ?? null, counterpartyInn: cp?.inn ?? null }
}

/** Совпадает ли сторона в документе с контрагентом из ЛК (защита от подмены чужих реквизитов). */
function partyMatches(html: string, name: string | null, inn: string | null): boolean {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  if (inn) {
    // ИНН из карточки может отличаться от текста форматированием (пробелы) —
    // сверяем и как есть, и по цифрам В ПРЕДЕЛАХ одной числовой группы. Соседние
    // числа не склеиваем, чтобы не ослабить защиту от подмены чужих реквизитов.
    if (text.includes(inn)) return true
    const innDigits = inn.replace(/\D/g, '')
    if (innDigits) {
      const runs = (text.match(/\d[\d\s]*\d|\d/g) ?? []).map((r) => r.replace(/\s+/g, ''))
      if (runs.includes(innDigits)) return true
    }
  }
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
/**
 * Полная сборка версии для показа/шаринга/экспорта с учётом слоя оформления.
 *
 * Два поколения контента:
 *  - legacy: шапка и реквизиты вклеены в Version.content (до слоя оформления,
 *    а также загруженные документы со своей шапкой) — отдаём как есть;
 *  - новый: Version.content — только тело; шапка/реквизиты берутся из
 *    Document.preambleHtml/requisitesHtml (шаг «Оформление») и оборачивают тело.
 */
export async function assemblePresentation(opts: {
  versionId: string
  documentId: string
  content: string | null
  userId: string
  userRole?: string
}): Promise<{ full: string; body: string; legacyInline: boolean }> {
  const presented = await getPresentationContent(
    opts.versionId, opts.documentId, opts.content, opts.userId, opts.userRole,
  )
  if (hasInlineRequisites(presented)) {
    return { full: presented, body: presented, legacyInline: true }
  }

  const doc = await prisma.document.findUnique({
    where: { id: opts.documentId },
    select: { preambleHtml: true, requisitesHtml: true },
  })
  const full = [doc?.preambleHtml, presented, doc?.requisitesHtml]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n')
  return { full, body: presented, legacyInline: false }
}

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
    // Шапку подменяем, только если она пришла из шага «Оформление»: это явное
    // решение пользователя. Без него шапка загруженного файла остаётся как есть.
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
