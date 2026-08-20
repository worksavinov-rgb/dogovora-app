import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const TYPE_ENUM = z.enum(['INDIVIDUAL', 'SELF_EMPLOYED', 'SOLE_PROPRIETOR', 'COMPANY', 'ANO', 'PAO', 'ZAO'])

const createSchema = z.object({
  name: z.string().min(1, 'Укажите название'),
  type: TYPE_ENUM.default('COMPANY'),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  legalAddress: z.string().optional(),
  actualAddress: z.string().optional(),
  passportSeries: z.string().optional(),
  passportNumber: z.string().optional(),
  passportIssuedBy: z.string().optional(),
  passportIssueDate: z.string().optional(),
  passportDeptCode: z.string().optional(),
  npdRegisteredDate: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
  // Подписант (опционально — создаётся при наличии fullName)
  signatory: z.object({
    fullName: z.string().min(1),
    signatureName: z.string().default(''),
    position: z.string().default(''),
    basisType: z.enum(['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']).default('CHARTER'),
    basisText: z.string().optional(),
  }).optional(),
})

// GET /api/counterparties?q=...&status=active|archive
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
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
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  let data: z.infer<typeof createSchema>
  try {
    data = createSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  // type, actualAddress и паспортные поля остаются в cpData — это колонки БД.
  const { bankName, checkingAccount, bik, correspondentAccount, signatory, ...cpData } = data

  const cp = await prisma.counterparty.create({
    data: {
      ...cpData,
      userId,
      bankDetails: (bankName || bik)
        ? { create: { bankName: bankName ?? '', checkingAccount: checkingAccount ?? '', bik: bik ?? '', correspondentAccount: correspondentAccount ?? '' } }
        : undefined,
      signatories: signatory?.fullName
        ? {
            create: [{
              fullName: signatory.fullName,
              signatureName: signatory.signatureName || (() => {
                const parts = signatory.fullName.split(' ')
                if (parts.length >= 2) return parts[0] + ' ' + parts.slice(1).map((p) => p[0] + '.').join('')
                return signatory.fullName
              })(),
              position: signatory.position || '',
              basisType: signatory.basisType || 'CHARTER',
              isDefault: true,
            }],
          }
        : undefined,
    },
    include: { bankDetails: true, signatories: { include: { scopes: true } } },
  })

  return NextResponse.json(cp, { status: 201 })
}
