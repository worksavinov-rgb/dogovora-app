import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifyToken, getTokenFromCookie } from '@/lib/auth'

const profileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  inn: z.string().optional().nullable(),
  kpp: z.string().optional().nullable(),
  ogrn: z.string().optional().nullable(),
  legalAddress: z.string().optional().nullable(),
  signatorName: z.string().optional().nullable(),
  signatorPosition: z.string().optional().nullable(),
  signatorBasis: z.string().optional().nullable(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
})

async function getCurrentUserId(req: NextRequest): Promise<string | null> {
  const cookieHeader = req.headers.get('cookie')
  const token = getTokenFromCookie(cookieHeader, 'access_token')
  if (!token) return null
  try {
    const payload = verifyToken(token)
    return payload.userId
  } catch {
    return null
  }
}

// ─── GET /api/profiles/:id ───────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const profile = await prisma.profile.findFirst({
    where: { id, userId },
    include: { bankDetails: true },
  })

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(profile)
}

// ─── PUT /api/profiles/:id ───────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.profile.findFirst({ where: { id, userId }, include: { bankDetails: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof profileUpdateSchema>
  try {
    data = profileUpdateSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    }
    throw err
  }

  const { bankName, checkingAccount, bik, correspondentAccount, ...profileData } = data

  // Обновляем профиль
  const profile = await prisma.profile.update({
    where: { id },
    data: profileData,
  })

  // Обновляем или создаём банковские реквизиты
  if (bankName !== undefined || checkingAccount !== undefined || bik !== undefined) {
    const bankData = {
      bankName: bankName ?? '',
      checkingAccount: checkingAccount ?? '',
      bik: bik ?? '',
      correspondentAccount: correspondentAccount ?? '',
    }
    if (existing.bankDetails.length > 0) {
      await prisma.bankDetail.update({
        where: { id: existing.bankDetails[0].id },
        data: bankData,
      })
    } else {
      await prisma.bankDetail.create({
        data: { ...bankData, profileId: id },
      })
    }
  }

  const updated = await prisma.profile.findFirst({
    where: { id },
    include: { bankDetails: true },
  })

  return NextResponse.json(updated)
}

// ─── DELETE /api/profiles/:id ────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.profile.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.profile.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
