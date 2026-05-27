import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifyToken, getTokenFromCookie } from '@/lib/auth'

// ─── Схема валидации ─────────────────────────────────────────────────────────

const profileSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY']),
  name: z.string().min(1, 'Укажите наименование'),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  legalAddress: z.string().optional(),
  signatorName: z.string().optional(),
  signatorPosition: z.string().optional(),
  signatorBasis: z.string().optional(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
})

// ─── Получить текущего пользователя из токена ────────────────────────────────

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

// ─── GET /api/profiles — список профилей пользователя ────────────────────────

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profiles = await prisma.profile.findMany({
    where: { userId },
    include: { bankDetails: true },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(profiles)
}

// ─── POST /api/profiles — создать профиль ────────────────────────────────────

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  let data: z.infer<typeof profileSchema>
  try {
    data = profileSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    }
    throw err
  }

  const { bankName, checkingAccount, bik, correspondentAccount, ...profileData } = data

  const profile = await prisma.profile.create({
    data: {
      ...profileData,
      userId,
      bankDetails: (bankName || checkingAccount || bik)
        ? {
            create: {
              bankName: bankName ?? '',
              checkingAccount: checkingAccount ?? '',
              bik: bik ?? '',
              correspondentAccount: correspondentAccount ?? '',
            },
          }
        : undefined,
    },
    include: { bankDetails: true },
  })

  return NextResponse.json(profile, { status: 201 })
}
