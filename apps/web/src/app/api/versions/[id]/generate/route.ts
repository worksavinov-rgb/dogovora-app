import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getGenerateQueue } from '@/lib/queue'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/generate — ставит задачу генерации в BullMQ очередь
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        include: {
          counterparty: { include: { bankDetails: { take: 1 } } },
          parentDocument: { select: { id: true, title: true, number: true } },
        },
      },
    },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const aiSettings = version.aiSettings as {
    protectionLevel?: number
    targetSize?: number
    customInstruction?: string
    description?: string
    profileId?: string
    referenceContent?: string  // образец структуры / загруженный бланк
    base?: string              // 'scratch' | 'template' | 'upload'
    userRole?: 'customer' | 'executor'
  }

  // Если уже есть контент И нет referenceContent (значит это не шаблон-для-генерации) — не перегенерируем
  if (version.content && !aiSettings?.referenceContent) {
    return NextResponse.json({ jobId: null, status: 'already_generated' })
  }

  const doc = version.document

  // Берём профиль по выбранному profileId (или первый если не выбрано).
  // Источник истины — Document.profileId (верхнеуровневое поле, задаётся при создании
  // документа и сохраняется надёжно). aiSettings?.profileId оставляем как fallback для
  // старых документов — но он не может быть основным источником: zod-схема aiSettings
  // в apps/web/src/app/api/documents/route.ts не объявляет это поле и тихо отбрасывает
  // его при сохранении, поэтому в БД оно почти всегда отсутствует (та же причина,
  // по которой ранее терялась выбранная роль userRole).
  const profiles = await prisma.profile.findMany({
    where: {
      userId,
      ...(doc.profileId ? { id: doc.profileId } : aiSettings?.profileId ? { id: aiSettings.profileId } : {}),
    },
    include: {
      bankDetails: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 1,
  })
  const profile = profiles[0]
  const profileSignatory = profile ? { fullName: profile.signatorName, position: profile.signatorPosition, basisType: profile.signatorBasis } : null
  const userProfile = profile ? {
    type: profile.type,
    name: profile.name,
    inn: profile.inn,
    kpp: profile.kpp,
    ogrn: profile.ogrn,
    ogrnDate: profile.ogrnDate ?? null,
    legalAddress: profile.legalAddress,
    // Если выбран подписант из ProfileSignatory — используем его, иначе fallback
    // на legacy одиночное поле profile.signatorName (старые профили без подписантов)
    signatorName: profileSignatory?.fullName ?? profile.signatorName,
    signatorPosition: profileSignatory?.position ?? profile.signatorPosition,
    signatorBasis: profileSignatory
      ? (profileSignatory.basisType === 'CHARTER'
          ? 'Устава'
          : profileSignatory.poaNumber
            ? `Доверенности № ${profileSignatory.poaNumber}`
            : 'Доверенности')
      : profile.signatorBasis,
    bankName: profile.bankDetails[0]?.bankName ?? null,
    checkingAccount: profile.bankDetails[0]?.checkingAccount ?? null,
    bik: profile.bankDetails[0]?.bik ?? null,
    correspondentAccount: profile.bankDetails[0]?.correspondentAccount ?? null,
    email: null,
  } : undefined

  // Полные данные контрагента для формирования шапки и реквизитов.
  // Источник истины для подписанта — Document.counterpartySignatoryId, выбранный
  // на шаге настройки; если не выбран — берём дефолтного подписанта контрагента.
  const cp = doc.counterparty
  const [cpSignatory] = await prisma.signatory.findMany({
    where: { counterpartyId: cp.id, isDefault: true },
    take: 1,
  })
  const counterpartyData = {
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
    signatorName: cpSignatory?.fullName ?? null,
    signatorPosition: cpSignatory?.position ?? null,
    signatorBasis: cpSignatory
      ? (cpSignatory.basisType === 'CHARTER'
          ? 'Устава'
          : cpSignatory.poaNumber
            ? `Доверенности № ${cpSignatory.poaNumber}`
            : 'Доверенности')
      : null,
  }

  // Для APPENDIX/AMENDMENT — находим финальную версию родительского договора
  // Приоритет: SIGNED → PAID → APPROVED → последняя по номеру
  let parentDocContent: string | undefined
  if (doc.parentDocument && (doc.type === 'APPENDIX' || doc.type === 'AMENDMENT')) {
    const parentVersions = await prisma.version.findMany({
      where: { documentId: doc.parentDocument.id },
      orderBy: { number: 'desc' },
      select: { status: true, content: true },
    })
    const priority = ['SIGNED', 'PAID', 'APPROVED']
    const best = priority.reduce<{ status: string; content: string | null } | null>((found, status) => {
      return found ?? (parentVersions.find((v) => v.status === status) ?? null)
    }, null) ?? parentVersions[0] ?? null
    parentDocContent = best?.content ?? undefined
  }

  const queue = getGenerateQueue()
  const job = await queue.add('generate', {
    versionId: id,
    description: aiSettings?.description ?? '',
    counterpartyName: doc.counterparty.name,
    protectionLevel: aiSettings?.protectionLevel ?? 70,
    targetSize: aiSettings?.targetSize ?? 8000,
    customInstruction: aiSettings?.customInstruction ?? '',
    docType: doc.type,
    docNumber: doc.number ?? undefined,
    signingDate: doc.signingDate ? doc.signingDate.toISOString() : undefined,
    documentNumber: doc.documentNumber ?? undefined,
    referenceContent: aiSettings?.referenceContent ?? undefined,
    base: aiSettings?.base ?? undefined,
    parentDocTitle: doc.parentDocument?.title ?? undefined,
    parentDocNumber: doc.parentDocument?.number ?? undefined,
    parentDocContent,
    // Источник истины — Document.userRole (enum, задаётся один раз при создании документа).
    // Раньше брали aiSettings?.userRole из JSON, но zod-схема при сохранении документа
    // (apps/web/src/app/api/documents/route.ts) не объявляла это поле внутри aiSettings —
    // оно тихо отбрасывалось при парсинге, и роль всегда падала в дефолт 'customer'
    // независимо от того, что выбрал пользователь в мастере создания документа.
    userRole: 'executor',
    userProfile,
    counterpartyData,
  })

  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
