import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getAIProvider } from '@/lib/ai/provider'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/review — проверка документа через ИИ
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const aiSettings = version.aiSettings as { protectionLevel?: number; targetSize?: number; customInstruction?: string }
  const settings = {
    protectionLevel: aiSettings?.protectionLevel ?? 70,
    targetSize: aiSettings?.targetSize ?? 8000,
    customInstruction: aiSettings?.customInstruction ?? '',
  }

  const aiProvider = getAIProvider()
  const result = await aiProvider.review(version.content ?? '', settings)
  return NextResponse.json(result)
}
