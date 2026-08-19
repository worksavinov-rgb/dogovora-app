import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { readFile, saveFile, versionFileKey } from '@/lib/storage'
import { convertToDocx, type RequisitesParty } from '@shared/formatting/html-docx-converter'
import { stripAiRequisitesBlock } from '@/lib/html-document'
import { looksLikeUpload } from '@/lib/structure-uploaded'
import { getPresentationContent } from '@/lib/presentation-content'
import { resolvePartyRole, toLowerRole } from '@/lib/party-roles'
import { resolveDocumentProfile, resolveCounterpartySignatory } from '@/lib/party-data'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/download
// Скачивание DOCX. Доступно только для оплаченных версий.
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          number: true,
          type: true,
          profileId: true,
          counterpartyId: true,
          parentDocumentId: true,
          signingDate: true,
        },
      },
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Предоплатная модель: скачивание доступно для любой версии владельца
  if (!version.content) {
    return NextResponse.json({ error: 'Документ ещё не сгенерирован' }, { status: 400 })
  }

  let docxBuffer: Buffer | null = null

  // Всегда генерируем заново — чтобы реквизиты были актуальными
  {
    try {
      // Загружаем реквизиты для блока подписей
      const profileId = version.document.profileId
      const counterpartyId = version.document.counterpartyId

      // Реальная роль пользователя в договоре. Для APPENDIX/AMENDMENT наследуем
      // от родительского договора, иначе читаем из настроек самой версии.
      // Единый resolvePartyRole используется и в предпросмотре (versions/[id]/route.ts):
      // так шапка и реквизиты в DOCX и на экране всегда совпадают.
      const userRole = await resolvePartyRole({
        aiSettings: version.aiSettings,
        parentDocumentId: version.document.parentDocumentId,
        userId,
      })

      // Профиль и подписант — через единые резолверы (те же, что в generate):
      // раньше выбор расходился, и в тексте был один подписант, в DOCX — другой.
      const [profile, counterparty] = await Promise.all([
        resolveDocumentProfile({ userId, profileId }),
        prisma.counterparty.findFirst({
          where: { id: counterpartyId, userId },
          include: { bankDetails: { take: 1 } },
        }),
      ])
      const cpSignatoryResolved = counterparty
        ? await resolveCounterpartySignatory(counterparty.id)
        : null

      const makeParty = (
        type: string,
        name: string | undefined | null,
        inn: string | null | undefined,
        kpp: string | null | undefined,
        ogrn: string | null | undefined,
        addr: string | null | undefined,
        email: string | null | undefined,
        sigName: string | null | undefined,
        sigPos: string | null | undefined,
        bank: { bankName: string; bik: string; checkingAccount: string; correspondentAccount: string } | null | undefined,
      ): RequisitesParty => ({
        type, name, inn, kpp, ogrn, legalAddress: addr, email,
        signatorName: sigName, signatorPosition: sigPos,
        bankName: bank?.bankName, bik: bank?.bik,
        checkingAccount: bank?.checkingAccount,
        correspondentAccount: bank?.correspondentAccount,
      })

      const myParty: RequisitesParty = makeParty(
        profile?.type ?? 'COMPANY',
        profile?.name,
        profile?.inn, profile?.kpp, profile?.ogrn,
        profile?.legalAddress, profile?.email,
        profile?.signatorName, profile?.signatorPosition,
        profile?.bankDetails[0],
      )

      const cpSignatory = cpSignatoryResolved
      const cpParty: RequisitesParty = makeParty(
        counterparty?.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR',
        counterparty?.name,
        counterparty?.inn, counterparty?.kpp, counterparty?.ogrn,
        counterparty?.legalAddress, counterparty?.email,
        cpSignatory?.fullName, cpSignatory?.position,
        counterparty?.bankDetails[0],
      )

      const isCustomer = userRole === 'CUSTOMER'
      // Кто Заказчик, а кто Исполнитель — зависит от роли пользователя.
      // Если пользователь Заказчик → его профиль слева (Заказчик), контрагент справа.
      // Если пользователь Исполнитель → наоборот.
      const customerParty = isCustomer ? myParty : cpParty
      const executorParty = isCustomer ? cpParty : myParty
      // ЗАГРУЖЕННЫЙ документ уже содержит собственные шапку, реквизиты и приложения —
      // системные не подставляем: иначе получались дубль шапки и обрезка «подвала»
      // вместе со всем, что идёт после него (приложения).
      const isUploadedDoc = looksLikeUpload(version.content ?? '')
      // Финальный раздел ставим всегда: для договора — полные реквизиты,
      // для приложения/допсоглашения — только подписи сторон (по docType).
      // Колонки в привычном порядке: слева Заказчик, справа Исполнитель.
      const requisites = (!isUploadedDoc && (profile || counterparty)) ? {
        left: customerParty,
        right: executorParty,
        leftTitle: 'Заказчик',
        rightTitle: 'Исполнитель',
        docType: version.document.type as 'CONTRACT' | 'APPENDIX' | 'AMENDMENT',
      } : undefined

      // Системная преамбула — только для договоров (у приложений/ДС своя шапка).
      // Шаблонную шапку с прочерками вырезаем, ставим заполненную.
      const signingDate = version.document.signingDate
        ? new Date(version.document.signingDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        : null
      const preamble = !isUploadedDoc && version.document.type === 'CONTRACT' && (profile || counterparty) ? {
        docTitle: version.document.title || 'Договор оказания услуг',
        docNumber: version.document.number,
        city: null,
        date: signingDate,
        customer: customerParty,
        executor: executorParty,
      } : undefined

      // Для загруженных документов достраиваем заголовки (эвристика + ИИ, с кэшем —
      // тем же, что предпросмотр), чтобы разделы центрировались и в Word. Оригинал цел.
      const contentPromoted = await getPresentationContent(
        id, version.document.id, version.content, userId,
        toLowerRole(userRole),
      )
      // Вырезаем блок реквизитов/подписей который мог быть в оригинальном Word-файле
      // (загруженные документы хранятся «как есть», без предварительной очистки).
      const contentForDocx = requisites ? stripAiRequisitesBlock(contentPromoted) : contentPromoted

      docxBuffer = await convertToDocx(contentForDocx, {
        title: version.document.title,
        requisites,
        preamble,
      })

      const formattedKey = versionFileKey(id, 'formatted.docx')
      await saveFile(formattedKey, docxBuffer)
      await prisma.version.update({
        where: { id },
        data: {
          formattingApplied: true,
        },
      })
    } catch (err) {
      logger.error({
        event: 'versions.download_format_failed',
        error: err,
        request_id: getRequestId(req),
        user_id: userId,
        version_id: id,
      })
      return NextResponse.json({ error: 'Ошибка создания файла' }, { status: 500 })
    }
  }

  // Формируем имя файла
  const safeTitle = (version.document.title ?? 'договор')
    .replace(/[^\wА-яЁё\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  const filename = `${safeTitle}_v${version.number}.docx`

  // Копируем буфер в собственный ArrayBuffer (BodyInit принимает ArrayBuffer)
  const arrayBuffer = docxBuffer.buffer.slice(docxBuffer.byteOffset, docxBuffer.byteOffset + docxBuffer.byteLength)

  return new NextResponse(arrayBuffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(docxBuffer.length),
    },
  })
}
