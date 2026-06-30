import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/formatted-html
// Возвращает HTML-версию отформатированного DOCX для отображения в браузере.
// Конвертирует formattedContent (Base64 DOCX) → HTML через mammoth.js
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: { formattedContent: true, formattingApplied: true },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!version.formattedContent) {
    return NextResponse.json({ error: 'Форматирование не применено' }, { status: 404 })
  }

  try {
    // Динамический импорт чтобы mammoth не тянулся в клиентский bundle
    const mammoth = (await import('mammoth')).default

    const buffer = Buffer.from(version.formattedContent, 'base64')
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h2:fresh",
          "p[style-name='Heading 2'] => h3:fresh",
          "p[style-name='Heading 3'] => h4:fresh",
        ],
      },
    )

    // Возвращаем только body контент (без обёртки html/head) —
    // клиент рендерит через dangerouslySetInnerHTML в изолированном контейнере
    return NextResponse.json(
      { html: result.value },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  } catch (err) {
    console.error('[formatted-html] mammoth error:', err)
    return NextResponse.json({ error: 'Ошибка конвертации DOCX в HTML' }, { status: 500 })
  }
}
