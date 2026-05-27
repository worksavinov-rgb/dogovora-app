import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const createSchema = z.object({
  name: z.string().min(1, 'Укажите название'),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  legalAddress: z.string().optional(),
  actualAddress: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  orgForm: z.string().optional(), // ООО, ИП, АО, АНО...
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
})

// GET /api/counterparties?q=...&status=active|archive
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const status = searchParams.get('status') // 'active' | 'archive' | null

  const counterparties = await prisma.counterparty.findMany({
    where: {
      userId,
      isArchived: status === 'archive' ? true : status === 'active' ? false : undefined,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { inn: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      bankDetails: true,
      signatories: { include: { scopes: true } },
      _count: { select: { documents: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  // Считаем версии через documents
  const result = await Promise.all(
    counterparties.map(async (cp) => {
      const versionCount = await prisma.version.count({
        where: { document: { counterpartyId: cp.id } },
      })
      return { ...cp, versionCount }
    })
  )

  return NextResponse.json(result)
}

// POST /api/counterparties
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  let data: z.infer<typeof createSchema>
  try {
    data = createSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const { bankName, checkingAccount, bik, correspondentAccount, orgForm, actualAddress, ...cpData } = data

  const cp = await prisma.counterparty.create({
    data: {
      ...cpData,
      userId,
      bankDetails: (bankName || bik)
        ? { create: { bankName: bankName ?? '', checkingAccount: checkingAccount ?? '', bik: bik ?? '', correspondentAccount: correspondentAccount ?? '' } }
        : undefined,
    },
    include: { bankDetails: true, signatories: { include: { scopes: true } } },
  })

  return NextResponse.json(cp, { status: 201 })
}
