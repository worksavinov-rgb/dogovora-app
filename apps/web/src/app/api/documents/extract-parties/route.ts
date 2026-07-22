import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { runWithAI } from '@/lib/ai/provider'

// POST /api/documents/extract-parties — извлечение реквизитов сторон из текста договора
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { text?: string; consentPii?: boolean }
  const { text, consentPii } = body

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  if (!consentPii) {
    return NextResponse.json(
      { error: 'Для автозаполнения реквизитов необходимо согласие на отправку данных в ИИ' },
      { status: 400 },
    )
  }

  const result = await runWithAI('extract_parties', { userId }, (aiProvider) =>
    aiProvider.extractParties(text),
  )
  return NextResponse.json(result)
}
