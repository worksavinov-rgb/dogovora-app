import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const signatorySchema = z.object({
  fullName: z.string().min(1, 'Укажите ФИО'),
  position: z.string().min(1, 'Укажите должность'),
  basisType: z.enum(['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']),
  poaNumber: z.string().optional().nullable(),
  poaDate: z.string().optional().nullable(),   // ISO date string
  poaExpiry: z.string().optional().nullable(), // ISO date string
  isDefault: z.boolean().optional(),
})

// POST /api/profiles/:id/signatories
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const profile = await prisma.profile.findFirst({ where: { id, userId } })
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof signatorySchema>
  try {
    data = signatorySchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  const { poaDate, poaExpiry, ...sigData } = data

  // Если это первый подписант профиля или явно помечен как дефолтный —
  // снимаем isDefault с остальных, чтобы он был единственным
  if (data.isDefault) {
    await prisma.profileSignatory.updateMany({ where: { profileId: id }, data: { isDefault: false } })
  }
  const existingCount = await prisma.profileSignatory.count({ where: { profileId: id } })

  const signatory = await prisma.profileSignatory.create({
    data: {
      ...sigData,
      poaDate: poaDate ? new Date(poaDate) : null,
      poaExpiry: poaExpiry ? new Date(poaExpiry) : null,
      isDefault: data.isDefault ?? existingCount === 0,
      profileId: id,
    },
  })

  return NextResponse.json(signatory, { status: 201 })
}
