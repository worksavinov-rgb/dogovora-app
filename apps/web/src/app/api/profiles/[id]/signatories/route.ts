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

// GET /api/profiles/:id/signatories
export async function GET(req: NextRequest, { params: _params }: Params) {
  return NextResponse.json([])
}

// POST /api/profiles/:id/signatories — подписанты профиля хранятся в самом профиле (signatorName, signatorPosition)
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const profile = await prisma.profile.findFirst({ where: { id, userId } })
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as { fullName?: string; position?: string; basisType?: string }

  const updated = await prisma.profile.update({
    where: { id },
    data: {
      signatorName: body.fullName,
      signatorPosition: body.position,
      signatorBasis: body.basisType,
    },
  })

  return NextResponse.json({ id: updated.id, fullName: updated.signatorName, position: updated.signatorPosition, isDefault: true }, { status: 201 })
}
