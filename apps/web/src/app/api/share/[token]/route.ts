import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getPresentationContent } from '@/lib/presentation-content'
import { resolvePartyRole, toLowerRole } from '@/lib/party-roles'
import { sanitizeHtml, isHtmlContent } from '@/lib/html-document'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ token: string }> }

// GET /api/share/:token — ПУБЛИЧНОЕ чтение версии по ссылке «показать
// контрагенту». Без авторизации. Отдаём только то, что видно на бумаге:
// название, номер, тип, дату и текст. Никаких данных владельца аккаунта.
export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params

  // Защита от перебора токенов: лимит по IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await rateLimit(`share:${ip}`, 60, 10 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 })
  }

  const link = await prisma.shareLink.findFirst({
    where: { token, revokedAt: null },
    include: {
      version: {
        include: {
          document: {
            select: {
              id: true,
              title: true,
              number: true,
              type: true,
              signingDate: true,
              parentDocumentId: true,
              userId: true,
            },
          },
        },
      },
    },
  })
  if (!link) return NextResponse.json({ error: 'Ссылка не найдена или отозвана' }, { status: 404 })

  const version = link.version
  const doc = version.document

  // Тот же презентационный конвейер, что видит владелец (структура + реквизиты)
  const role = await resolvePartyRole({
    aiSettings: version.aiSettings,
    parentDocumentId: doc.parentDocumentId,
    userId: doc.userId,
  })
  const raw = await getPresentationContent(
    version.id, doc.id, version.content, doc.userId, toLowerRole(role),
  )
  // Дополнительная санитация перед публичной отдачей HTML
  const content = isHtmlContent(raw) ? sanitizeHtml(raw) : raw

  return NextResponse.json({
    title: doc.title,
    number: doc.number,
    type: doc.type,
    versionNumber: version.number,
    signingDate: doc.signingDate,
    updatedAt: version.createdAt,
    content,
  })
}
