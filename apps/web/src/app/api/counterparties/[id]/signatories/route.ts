import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const signatorySchema = z.object({
  fullName: z.string().min(1, 'Укажите ФИО'),
  signatureName: z.string().min(1, 'Укажите краткое имя для подписи'),
  position: z.string().min(1, 'Укажите должность'),
  basisType: z.enum(['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']),
  poaNumber: z.string().optional().nullable(),
  poaDate: z.string().optional().nullable(),   // ISO date string
  poaExpiry: z.string().optional().nullable(), // ISO date string
  isDefault: z.boolean().optional(),
  scopes: z.array(z.enum(['CONTRACT', 'APPENDIX', 'AMENDMENT', 'ACT'])).optional(),
})

// POST /api/counterparties/:id/signatories
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const cp = await prisma.counterparty.findFirst({ where: { id, userId } })
  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof signatorySchema>
  try {
    data = signatorySchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const { scopes, poaDate, poaExpiry, ...sigData } = data

  const signatory = await prisma.signatory.create({
    data: {
      ...sigData,
      poaDate: poaDate ? new Date(poaDate) : null,
      poaExpiry: poaExpiry ? new Date(poaExpiry) : null,
      counterpartyId: id,
      scopes: scopes?.length
        ? { create: scopes.map((scope) => ({ scope })) }
        : undefined,
    },
    include: { scopes: true },
  })

  return NextResponse.json(signatory, { status: 201 })
}
