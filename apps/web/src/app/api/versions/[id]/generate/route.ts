import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getGenerateQueue } from '@/lib/queue'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/generate — ставит задачу генерации в BullMQ очередь
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: { document: { include: { counterparty: true } } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Если уже есть контент — не перегенерируем (защита от дублей)
  if (version.content) {
    return NextResponse.json({ jobId: null, status: 'already_generated' })
  }

  const aiSettings = version.aiSettings as {
    protectionLevel?: number
    targetSize?: number
    customInstruction?: string
    description?: string
  }

  const queue = getGenerateQueue()
  const job = await queue.add('generate', {
    versionId: id,
    description: aiSettings?.description ?? '',
    counterpartyName: version.document.counterparty.name,
    protectionLevel: aiSettings?.protectionLevel ?? 70,
    targetSize: aiSettings?.targetSize ?? 8000,
    customInstruction: aiSettings?.customInstruction ?? '',
  })

  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
