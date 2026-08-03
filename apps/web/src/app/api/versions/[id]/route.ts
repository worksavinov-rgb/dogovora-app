import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getPresentationContent } from '@/lib/presentation-content'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id — полная информация о версии включая content
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          type: true,
          counterparty: {
            select: {
              id: true,
              name: true,
              inn: true,
              kpp: true,
              ogrn: true,
              legalAddress: true,
              email: true,
              bankDetails: { take: 1 },
              signatories: { where: { isDefault: true }, take: 1 },
            },
          },
          profile: {
            include: { bankDetails: { take: 1 } },
          },
        },
      },
      purchase: true,
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Для загруженных документов: заголовки (эвристика + ИИ, кэш) + эталонные шапка
  // и реквизиты из ЛК. Оригинал в БД не меняем.
  const aiSettingsForRole = version.aiSettings as { userRole?: string } | null
  const content = await getPresentationContent(
    version.id, version.document.id, version.content, userId, aiSettingsForRole?.userRole,
  )

  return NextResponse.json({
    id: version.id,
    number: version.number,
    status: version.status,
    content,
    fileSize: version.fileSize,
    aiSettings: version.aiSettings,
    createdAt: version.createdAt,
    document: version.document,
    purchase: version.purchase,
  })
}

// DELETE /api/versions/:id — удаление версии (в т.ч. оплаченной).
// Оплаченную версию удалять можно: покупка (Purchase) уходит каскадом, но
// запись об оплате в истории (Transaction.relatedVersion = SetNull) сохраняется
// навсегда, а списанные средства НЕ возвращаются. Предупреждение — на фронте.
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: { id: true },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // FK purchases→versions = RESTRICT: покупку удаляем до версии. Запись об оплате
  // в истории остаётся (transactions→versions = SET NULL), деньги не возвращаются.
  await prisma.$transaction([
    prisma.purchase.deleteMany({ where: { versionId: id } }),
    prisma.version.delete({ where: { id } }),
  ])
  return NextResponse.json({ ok: true })
}
