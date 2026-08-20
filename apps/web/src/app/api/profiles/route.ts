import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { normalizeFormat, validateFormat } from '@/lib/document-number'

// ─── Схема валидации ─────────────────────────────────────────────────────────

// Шаблон номера договора («{NNN}/{ММ}-{ГГ}»). Пустая строка осознанно
// превращается в null: «очистить поле» и «нумерация не настроена» — это одно
// состояние, два представления породили бы разное поведение UI.
const contractNumberFormatSchema = z
  .string()
  .trim()
  .transform((v) => (v ? normalizeFormat(v) : ''))
  .refine((v) => v === '' || validateFormat(v) === null, {
    message: 'Некорректный шаблон номера договора',
  })
  .transform((v) => (v === '' ? null : v))

const profileSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'SELF_EMPLOYED', 'SOLE_PROPRIETOR', 'COMPANY', 'ANO', 'PAO', 'ZAO']),
  name: z.string().min(1, 'Укажите наименование'),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  ogrnDate: z.string().optional(),
  email: z.string().optional(),
  legalAddress: z.string().optional(),
  actualAddress: z.string().optional(),
  phone: z.string().optional(),
  passportSeries: z.string().optional(),
  passportNumber: z.string().optional(),
  passportIssuedBy: z.string().optional(),
  passportIssueDate: z.string().optional(),
  passportDeptCode: z.string().optional(),
  npdRegisteredDate: z.string().optional(),
  signatorName: z.string().optional(),
  signatorPosition: z.string().optional(),
  signatorBasis: z.string().optional(),
  bankName: z.string().optional(),
  checkingAccount: z.string().optional(),
  bik: z.string().optional(),
  correspondentAccount: z.string().optional(),
  contractNumberFormat: contractNumberFormatSchema.optional(),
})

// ─── Получить текущего пользователя из токена ────────────────────────────────

// Авторизация — через общий getUserId (api-auth): он, в отличие от локальной
// копии, проверяет отзыв токена (blocklist по jti). Раньше отозванный после
// логаута токен ещё до 15 минут работал на маршрутах реквизитов.
const getCurrentUserId = (req: NextRequest) => getUserId(req)

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
