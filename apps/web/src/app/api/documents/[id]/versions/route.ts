import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const versionSchema = z.object({
  aiSettings: z.object({
    protectionLevel: z.number().min(0).max(100),
    targetSize: z.number(),
    customInstruction: z.string(),
    base: z.string().optional(),
    description: z.string().optional(),
  }),
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'PAID']).optional(),
  // Текст документа — передаётся при сохранении отредактированного через ИИ документа
  content: z.string().optional(),
})

// POST /api/documents/:id/versions  — APPEND-ONLY, никогда не обновляет существующую
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: { id, userId } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof versionSchema>
  try {
    data = versionSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  // Определяем следующий номер версии
  const lastVersion = await prisma.version.findFirst({
    where: { documentId: id },
    orderBy: { number: 'desc' },
  })
  const nextNumber = (lastVersion?.number ?? 0) + 1

  const version = await prisma.version.create({
    data: {
      documentId: id,
      number: nextNumber,
      status: data.status ?? 'DRAFT',
      aiSettings: data.aiSettings,
      // Если передан готовый текст (из ИИ-чата), сразу сохраняем в content
      ...(data.content ? {
        content: data.content,
        fileSize: Buffer.byteLength(data.content, 'utf8'),
      } : {}),
    },
    include: { purchase: true },
  })

  // Обновляем updatedAt документа
  await prisma.document.update({ where: { id }, data: { updatedAt: new Date() } })

  return NextResponse.json(version, { status: 201 })
}
