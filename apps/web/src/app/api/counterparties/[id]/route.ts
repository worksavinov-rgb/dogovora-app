import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  inn: z.string().optional().nullable(),
  kpp: z.string().optional().nullable(),
  ogrn: z.string().optional().nullable(),
  legalAddress: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isArchived: z.boolean().optional(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
})

// GET /api/counterparties/:id
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
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
        },
      },
    },
  })

  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(cp)
}

// PUT /api/counterparties/:id
export async function PUT(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
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

// DELETE /api/counterparties/:id  (мягкое удаление = архив)
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.counterparty.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.counterparty.update({ where: { id }, data: { isArchived: true } })
  return NextResponse.json({ ok: true })
}
