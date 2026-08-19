import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { isUploadedDocument } from '@/lib/token-charges'
import { TOKEN_PRICES } from '@/lib/token-pricing'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ instruction: z.string().max(4000).optional() })

// POST /api/documents/:id/rewrite — «Переписать заново»: новая версия (append-only)
// с referenceContent = текст последней версии и флагом rewrite. Списание REWRITE
// делает /api/versions/:id/generate по этому флагу — здесь только подготовка версии.
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await isUploadedDocument(id))) {
    return NextResponse.json({ error: 'Переписать заново можно только загруженный документ' }, { status: 400 })
  }

  const data = schema.parse(await req.json().catch(() => ({})))

  const last = await prisma.version.findFirst({
    where: { documentId: id },
    orderBy: { number: 'desc' },
  })
  if (!last?.content) return NextResponse.json({ error: 'Нет текста для переписки' }, { status: 400 })

  const prevSettings = last.aiSettings as Record<string, unknown>
  await prisma.version.updateMany({
    where: { documentId: id, status: { notIn: ['SIGNED', 'PAID'] } },
    data: { status: 'DRAFT' },
  })
  const version = await prisma.version.create({
    data: {
      documentId: id,
      number: last.number + 1,
      status: 'DRAFT',
      aiSettings: {
        ...prevSettings,
        rewrite: true,
        referenceContent: last.content,
        customInstruction: data.instruction ?? (prevSettings['customInstruction'] as string | undefined) ?? '',
      },
    },
  })
  await prisma.document.update({ where: { id }, data: { updatedAt: new Date() } })

  return NextResponse.json({ versionId: version.id, price: TOKEN_PRICES.rewrite }, { status: 201 })
}
