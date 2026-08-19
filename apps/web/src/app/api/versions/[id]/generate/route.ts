import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getGenerateQueue } from '@/lib/queue'
import { resolvePartyRole, toLowerRole } from '@/lib/party-roles'
import { buildDocumentParties } from '@/lib/party-data'
import { chargeTokens, InsufficientTokensError, insufficientTokensResponse } from '@/lib/token-charges'
import { TOKEN_PRICES } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/generate — ставит задачу генерации в BullMQ очередь
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
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

  // ─── Предоплата токенами ────────────────────────────────────────────────────
  // GENERATE — идемпотентно на документ (ретрай после падения деньги не спишет
  // повторно: возврат снимает идемпотентность через refundedAt).
  // REWRITE (см. /rewrite) — новое списание на каждую переписку, идемпотентно
  // по версии через существующий charge с этим versionId.
  const isRewrite = Boolean((aiSettings as { rewrite?: boolean })?.rewrite)
  let chargeId: string | undefined
  try {
    if (isRewrite) {
      const res = await chargeTokens({
        userId,
        kind: 'REWRITE',
        tokens: TOKEN_PRICES.rewrite,
        documentId: doc.id,
        versionId: id,
        idempotentPerVersion: true,
        description: `Переписка документа: ${doc.title}`,
      })
      chargeId = res.chargeId
    } else {
      const res = await chargeTokens({
        userId,
        kind: 'GENERATE',
        tokens: TOKEN_PRICES.generate,
        documentId: doc.id,
        versionId: id,
        idempotentPerDocument: true,
        description: `Генерация документа: ${doc.title}`,
      })
      chargeId = res.chargeId
    }
  } catch (err) {
    if (err instanceof InsufficientTokensError) return insufficientTokensResponse(err)
    throw err
  }

  // Стороны документа — единая сборка buildDocumentParties (та же, что в decor
  // и выгрузке): Document.profileId → aiSettings.profileId (fallback для старых
  // документов) → первый созданный; подписант контрагента — дефолтный.
  const { userProfile, counterpartyData } = await buildDocumentParties({
    userId,
    profileId: doc.profileId,
    fallbackProfileId: aiSettings?.profileId,
    counterpartyId: doc.counterpartyId,
  })

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
    chargeId,
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
    // Роль пользователя (Заказчик/Исполнитель) — единый resolvePartyRole, тот же,
    // что в предпросмотре, выгрузке и проверке рисков. Иначе документ генерируется
    // с одной ролью, а показывается/скачивается с другой (болезнь уже ловили).
    // Для приложений/ДС роль наследуется от родительского договора.
    userRole: toLowerRole(await resolvePartyRole({
      aiSettings: version.aiSettings,
      parentDocumentId: doc.parentDocumentId,
      userId,
    })),
    userProfile,
    counterpartyData,
  })

  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
