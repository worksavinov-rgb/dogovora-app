import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { readFile, saveFile, versionFileKey } from '@/lib/storage'
import { convertToDocx, type RequisitesParty } from '@shared/formatting/html-docx-converter'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/download
// Скачивание DOCX. Доступно только для оплаченных версий.
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: {
          title: true,
          number: true,
          type: true,
          profileId: true,
          counterpartyId: true,
          parentDocumentId: true,
        },
      },
      purchase: true,
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Проверяем оплату
  if (!version.purchase) {
    return NextResponse.json({ error: 'Версия не оплачена. Для скачивания необходимо купить версию.' }, { status: 403 })
  }

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
      // Источники: aiSettings.userRole ('customer'|'executor') либо текст
      // customInstruction («Пользователь является исполнителем/заказчиком»).
      const resolveRole = (ai: unknown): 'CUSTOMER' | 'EXECUTOR' | null => {
        if (!ai || typeof ai !== 'object') return null
        const a = ai as { userRole?: string; customInstruction?: string }
        const raw = (a.userRole ?? '').toString().toLowerCase()
        if (raw === 'customer' || raw === 'executor') return raw.toUpperCase() as 'CUSTOMER' | 'EXECUTOR'
        const instr = a.customInstruction ?? ''
        if (/заказчик/i.test(instr)) return 'CUSTOMER'
        if (/исполнител/i.test(instr)) return 'EXECUTOR'
        return null
      }
      let userRole = resolveRole(version.aiSettings)
      if (!userRole && version.document.parentDocumentId) {
        const parentVersion = await prisma.version.findFirst({
          where: { document: { id: version.document.parentDocumentId, userId } },
          orderBy: { number: 'desc' },
          select: { aiSettings: true },
        })
        userRole = resolveRole(parentVersion?.aiSettings)
      }
      userRole = userRole ?? 'EXECUTOR'

      const [profile, counterparty] = await Promise.all([
        // Если профиль не выбран на документе — берём первый профиль пользователя
        prisma.profile.findFirst({
          where: profileId ? { id: profileId, userId } : { userId },
          include: { bankDetails: { take: 1 } },
        }),
        prisma.counterparty.findFirst({
          where: { id: counterpartyId, userId },
          include: {
            bankDetails: { take: 1 },
            signatories: { where: { isDefault: true }, take: 1 },
          },
        }),
      ])

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

      const cpSignatory = counterparty?.signatories[0] ?? null
      const cpParty: RequisitesParty = makeParty(
        counterparty?.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR',
        counterparty?.name,
        counterparty?.inn, counterparty?.kpp, counterparty?.ogrn,
        counterparty?.legalAddress, counterparty?.email,
        cpSignatory?.fullName, cpSignatory?.position,
        counterparty?.bankDetails[0],
      )

      const isCustomer = userRole === 'CUSTOMER'
      // Финальный раздел ставим всегда: для договора — полные реквизиты,
      // для приложения/допсоглашения — только подписи сторон (по docType).
      const requisites = (profile || counterparty) ? {
        left: isCustomer ? myParty : cpParty,
        right: isCustomer ? cpParty : myParty,
        leftTitle: isCustomer ? 'Заказчик' : 'Исполнитель',
        rightTitle: isCustomer ? 'Исполнитель' : 'Заказчик',
        docType: version.document.type as 'CONTRACT' | 'APPENDIX' | 'AMENDMENT',
      } : undefined

      docxBuffer = await convertToDocx(version.content, {
        title: version.document.title,
        requisites,
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
      console.error('[download] Formatter error:', err)
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
