import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { runWithAI } from '@/lib/ai/provider'
import { anonymizeForAnalysis } from '@/lib/anonymize'
import { resolvePartyRole } from '@/lib/party-roles'
import { logger } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/review — проверка документа через ИИ
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: { document: { select: { parentDocumentId: true } } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Роль пользователя — тем же resolvePartyRole, что предпросмотр и выгрузка.
  // Раньше роль сюда не передавалась вовсе: модель выбирала сторону наугад и
  // могла анализировать договор с позиции контрагента.
  const role = await resolvePartyRole({
    aiSettings: version.aiSettings,
    parentDocumentId: version.document.parentDocumentId,
    userId,
  })

  const aiSettings = version.aiSettings as { protectionLevel?: number; targetSize?: number; customInstruction?: string }
  const settings = {
    protectionLevel: aiSettings?.protectionLevel ?? 70,
    targetSize: aiSettings?.targetSize ?? 8000,
    customInstruction: aiSettings?.customInstruction ?? '',
    userRoleName: (role === 'CUSTOMER' ? 'Заказчик' : 'Исполнитель') as 'Заказчик' | 'Исполнитель',
  }

  try {
    const result = await runWithAI('review', { userId, versionId: id }, (aiProvider) =>
      aiProvider.review(anonymizeForAnalysis(version.content ?? ''), settings),
    )
    return NextResponse.json(result)
  } catch (err) {
    // Мусорный ответ модели или сбой провайдера — отдаём человекочитаемую ошибку,
    // а не голый 500 (текст ответа модели пользователю не показываем).
    logger.error({ event: 'review.failed', version_id: id, error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json(
      { error: 'Не удалось выполнить проверку. Попробуйте ещё раз через минуту.' },
      { status: 502 },
    )
  }
}
