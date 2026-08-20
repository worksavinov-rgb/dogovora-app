import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { normalizeFormat, validateFormat } from '@/lib/document-number'

// Шаблон номера договора («{NNN}/{ММ}-{ГГ}»). Пустая строка и null — одно и то
// же состояние «нумерация не настроена», приводим к null.
const contractNumberFormatSchema = z
  .string()
  .nullable()
  .transform((v) => (v ? normalizeFormat(v.trim()) : ''))
  .refine((v) => v === '' || validateFormat(v) === null, {
    message: 'Некорректный шаблон номера договора',
  })
  .transform((v) => (v === '' ? null : v))

const profileUpdateSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'SELF_EMPLOYED', 'SOLE_PROPRIETOR', 'COMPANY', 'ANO', 'PAO', 'ZAO']).optional(),
  name: z.string().min(1).optional(),
  inn: z.string().optional().nullable(),
  kpp: z.string().optional().nullable(),
  ogrn: z.string().optional().nullable(),
  ogrnDate: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  legalAddress: z.string().optional().nullable(),
  actualAddress: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  passportSeries: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  passportIssuedBy: z.string().optional().nullable(),
  passportIssueDate: z.string().optional().nullable(),
  passportDeptCode: z.string().optional().nullable(),
  npdRegisteredDate: z.string().optional().nullable(),
  signatorName: z.string().optional().nullable(),
  signatorPosition: z.string().optional().nullable(),
  signatorBasis: z.string().optional().nullable(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
  contractNumberFormat: contractNumberFormatSchema.optional(),
})

// Авторизация — через общий getUserId (api-auth) с проверкой отзыва токена.
const getCurrentUserId = (req: NextRequest) => getUserId(req)

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
