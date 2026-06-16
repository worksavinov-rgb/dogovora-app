import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { getAIProvider } from '@/lib/ai/provider'

// POST /api/documents/extract-parties — извлечение реквизитов сторон из текста договора
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { text?: string }
  const { text } = body

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const aiProvider = getAIProvider()
  const result = await aiProvider.extractParties(text)
  return NextResponse.json(result)
}
