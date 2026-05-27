import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string; sid: string }> }

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  signatureName: z.string().min(1).optional(),
  position: z.string().min(1).optional(),
  basisType: z.enum(['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']).optional(),
  poaNumber: z.string().optional().nullable(),
  poaDate: z.string().optional().nullable(),
  poaExpiry: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  scopes: z.array(z.enum(['CONTRACT', 'APPENDIX', 'AMENDMENT', 'ACT'])).optional(),
})

// PUT /api/counterparties/:id/signatories/:sid
export async function PUT(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, sid } = await params
  const cp = await prisma.counterparty.findFirst({ where: { id, userId } })
  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof updateSchema>
  try {
    data = updateSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const { scopes, poaDate, poaExpiry, ...sigData } = data

  if (scopes !== undefined) {
    await prisma.signatoryScope.deleteMany({ where: { signatoryId: sid } })
    if (scopes.length > 0) {
      await prisma.signatoryScope.createMany({ data: scopes.map((scope) => ({ signatoryId: sid, scope })) })
    }
  }

  const signatory = await prisma.signatory.update({
    where: { id: sid },
    data: {
      ...sigData,
      poaDate: poaDate !== undefined ? (poaDate ? new Date(poaDate) : null) : undefined,
      poaExpiry: poaExpiry !== undefined ? (poaExpiry ? new Date(poaExpiry) : null) : undefined,
    },
    include: { scopes: true },
  })

  return NextResponse.json(signatory)
}

// DELETE /api/counterparties/:id/signatories/:sid
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, sid } = await params
  const cp = await prisma.counterparty.findFirst({ where: { id, userId } })
  if (!cp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.signatory.delete({ where: { id: sid } })
  return NextResponse.json({ ok: true })
}
