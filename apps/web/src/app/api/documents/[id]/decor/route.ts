import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { buildDocumentParties } from '@/lib/party-data'
import { resolvePartyRole } from '@/lib/party-roles'
import { buildContractPreambleHtml, buildChildDocPreambleHtml, buildRequisitesHtml, sanitizeHtml } from '@/lib/html-document'

type Params = { params: Promise<{ id: string }> }

// Слой оформления документа: шапка (преамбула) и блок реквизитов/подписей.
// Хранится на документе (Document.preambleHtml/requisitesHtml), подставляется
// при показе и экспорте — тело версии (Version.content) не трогается никогда.

async function loadDoc(id: string, userId: string) {
  return prisma.document.findFirst({
    where: { id, userId },
    include: { parentDocument: { select: { title: true, number: true } } },
  })
}

// GET /api/documents/:id/decor — текущие блоки оформления
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await loadDoc(id, userId)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    preambleHtml: doc.preambleHtml,
    requisitesHtml: doc.requisitesHtml,
    confirmed: Boolean(doc.preambleHtml || doc.requisitesHtml),
    profileId: doc.profileId,
    signingDate: doc.signingDate,
  })
}

const buildSchema = z.object({
  profileId: z.string().optional(),
  signatoryId: z.string().optional(),
  city: z.string().max(100).optional(),
  signingDate: z.string().optional(),
  /** true — только построить и вернуть (живой предпросмотр), без сохранения */
  preview: z.boolean().optional().default(false),
})

// POST /api/documents/:id/decor — построить блоки из карточек (и сохранить)
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await loadDoc(id, userId)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let data: z.infer<typeof buildSchema>
  try {
    data = buildSchema.parse(await req.json().catch(() => ({})))
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const { userProfile, counterpartyData, city } = await buildDocumentParties({
    userId,
    profileId: data.profileId ?? doc.profileId,
    counterpartyId: doc.counterpartyId,
    signatoryId: data.signatoryId,
  })
  if (!userProfile || !counterpartyData) {
    return NextResponse.json(
      { error: 'Заполните реквизиты своей компании и контрагента, чтобы собрать оформление' },
      { status: 400 },
    )
  }

  // Роль — единый resolvePartyRole (наследуется от родителя для приложений/ДС)
  const firstVersion = await prisma.version.findFirst({
    where: { documentId: id },
    orderBy: { number: 'asc' },
    select: { aiSettings: true },
  })
  const role = await resolvePartyRole({
    aiSettings: firstVersion?.aiSettings ?? {},
    parentDocumentId: doc.parentDocumentId,
    userId,
  })
  const role1 = role === 'EXECUTOR' ? 'Исполнитель' : 'Заказчик'
  const role2 = role === 'EXECUTOR' ? 'Заказчик' : 'Исполнитель'

  const chosenCity = data.city?.trim() || city || 'Москва'
  const signingDate = data.signingDate ?? (doc.signingDate ? doc.signingDate.toISOString() : undefined)

  const preambleHtml = doc.type === 'CONTRACT'
    ? buildContractPreambleHtml(userProfile, counterpartyData, role1, role2, chosenCity, signingDate)
    : buildChildDocPreambleHtml(
        userProfile, counterpartyData, role1, role2, doc.type,
        doc.documentNumber ?? undefined, doc.parentDocument?.number ?? undefined,
        doc.parentDocument?.title ?? undefined, chosenCity, signingDate,
      )
  const requisitesHtml = buildRequisitesHtml(userProfile, counterpartyData, role1, role2)

  if (!data.preview) {
    await prisma.document.update({
      where: { id },
      data: {
        preambleHtml,
        requisitesHtml,
        ...(data.profileId ? { profileId: data.profileId } : {}),
        ...(data.signingDate ? { signingDate: new Date(data.signingDate) } : {}),
      },
    })
  }

  return NextResponse.json({ preambleHtml, requisitesHtml, confirmed: !data.preview })
}

const patchSchema = z.object({
  preambleHtml: z.string().max(100_000).optional(),
  requisitesHtml: z.string().max(100_000).optional(),
})

// PATCH /api/documents/:id/decor — сохранить отредактированные вручную блоки
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let data: z.infer<typeof patchSchema>
  try {
    data = patchSchema.parse(await req.json())
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  await prisma.document.update({
    where: { id },
    data: {
      ...(data.preambleHtml !== undefined ? { preambleHtml: sanitizeHtml(data.preambleHtml) } : {}),
      ...(data.requisitesHtml !== undefined ? { requisitesHtml: sanitizeHtml(data.requisitesHtml) } : {}),
    },
  })
  return NextResponse.json({ ok: true })
}

// DELETE /api/documents/:id/decor — убрать оформление (скачивание «без шапки»)
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId }, select: { id: true } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.document.update({ where: { id }, data: { preambleHtml: null, requisitesHtml: null } })
  return NextResponse.json({ ok: true })
}
