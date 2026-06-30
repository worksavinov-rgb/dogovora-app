import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string; sid: string }> }

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  position: z.string().min(1).optional(),
  basisType: z.enum(['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']).optional(),
  poaNumber: z.string().optional().nullable(),
  poaDate: z.string().optional().nullable(),
  poaExpiry: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
})

// PUT /api/profiles/:id/signatories/:sid
export async function PUT(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, sid } = await params
  const profile = await prisma.profile.findFirst({ where: { id, userId } })
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof updateSchema>
  try {
    data = updateSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  await prisma.profile.update({
    where: { id },
    data: {
      signatorName: data.fullName,
      signatorPosition: data.position,
      signatorBasis: data.basisType,
    },
  })

  return NextResponse.json({ id: sid, fullName: data.fullName, position: data.position, isDefault: true })
}

// DELETE /api/profiles/:id/signatories/:sid
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const profile = await prisma.profile.findFirst({ where: { id, userId } })
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.profile.update({ where: { id }, data: { signatorName: null, signatorPosition: null, signatorBasis: null } })
  return NextResponse.json({ ok: true })
}
