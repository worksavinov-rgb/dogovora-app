import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const contactSchema = z.object({
  role: z.string().max(80).default(''),
  email: z.string().max(200).default(''),
  phone: z.string().max(50).default(''),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['INDIVIDUAL', 'SELF_EMPLOYED', 'SOLE_PROPRIETOR', 'COMPANY', 'ANO', 'PAO', 'ZAO']).optional(),
  inn: z.string().optional().nullable(),
  kpp: z.string().optional().nullable(),
  ogrn: z.string().optional().nullable(),
  legalAddress: z.string().optional().nullable(),
  actualAddress: z.string().optional().nullable(),
  passportSeries: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  passportIssuedBy: z.string().optional().nullable(),
  passportIssueDate: z.string().optional().nullable(),
  passportDeptCode: z.string().optional().nullable(),
  npdRegisteredDate: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  contacts: z.array(contactSchema).max(3).optional(),
  isArchived: z.boolean().optional(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
})

// GET /api/counterparties/:id
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const cp = await prisma.counterparty.findFirst({
    where: { id, userId },
    include: {
      bankDetails: true,
      signatories: { include: { scopes: true }, orderBy: { createdAt: 'asc' } },
      documents: {
        orderBy: { updatedAt: 'desc' },
        include: {
          versions: { orderBy: { number: 'desc' }, include: { purchase: true } },
          parentDocument: { select: { id: true, title: true, number: true } },
          _count: { select: { childDocuments: true, versions: true } },
        },
      },
    },
  })

  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(cp)
}

// PUT /api/counterparties/:id
export async function PUT(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.counterparty.findFirst({ where: { id, userId }, include: { bankDetails: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof updateSchema>
  try {
    data = updateSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const { bankName, checkingAccount, bik, correspondentAccount, ...cpData } = data

  await prisma.counterparty.update({ where: { id }, data: cpData })

  if (bankName !== undefined || bik !== undefined) {
    const bankData = { bankName: bankName ?? '', checkingAccount: checkingAccount ?? '', bik: bik ?? '', correspondentAccount: correspondentAccount ?? '' }
    if (existing.bankDetails.length > 0) {
      await prisma.bankDetail.update({ where: { id: existing.bankDetails[0].id }, data: bankData })
    } else {
      await prisma.bankDetail.create({ data: { ...bankData, counterpartyId: id } })
    }
  }

  const updated = await prisma.counterparty.findFirst({
    where: { id },
    include: { bankDetails: true, signatories: { include: { scopes: true } } },
  })
  return NextResponse.json(updated)
}

// DELETE /api/counterparties/:id — двухступенчатое удаление:
//  • активный контрагент → уходит в архив вместе со всеми документами
//    (документы архивных контрагентов скрываются из списка документов);
//  • уже архивный контрагент → удаляется БЕЗВОЗВРАТНО вместе со всеми
//    документами, версиями и покупками. Записи об оплате в истории
//    (Transaction.relatedVersion = SetNull) сохраняются, деньги не возвращаются.
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.counterparty.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!existing.isArchived) {
    await prisma.counterparty.update({ where: { id }, data: { isArchived: true } })
    return NextResponse.json({ ok: true, archived: true })
  }

  // Жёсткое удаление. Порядок важен из-за FK-ограничений в БД:
  //  • purchases→versions = RESTRICT → покупки удаляем первыми;
  //  • Document→Counterparty = RESTRICT → документы удаляем до контрагента;
  //  • версии/чат уходят каскадом с документом, записи об оплате в истории
  //    остаются (transactions→versions = SET NULL), деньги не возвращаются.
  const docs = await prisma.document.findMany({ where: { counterpartyId: id, userId }, select: { id: true } })
  const docIds = docs.map((d) => d.id)
  const versions = await prisma.version.findMany({ where: { documentId: { in: docIds } }, select: { id: true } })
  const versionIds = versions.map((v) => v.id)
  await prisma.$transaction([
    prisma.purchase.deleteMany({ where: { versionId: { in: versionIds } } }),
    prisma.document.deleteMany({ where: { counterpartyId: id, userId } }),
    prisma.counterparty.delete({ where: { id } }),
  ])
  return NextResponse.json({ ok: true, deleted: true })
}
