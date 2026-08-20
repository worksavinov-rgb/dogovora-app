import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { runWithAI } from '@/lib/ai/provider'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import type { AISettings } from '@/lib/ai/types'

// ПРОТОТИП: ИИ-правка/переписывание документа с показом результата через docx-preview.
// Поток: .docx → HTML (mammoth) → наш editDocument (те же модели/движок) → convertToDocx
// → отдаём .docx. Фронт рисует его docx-preview — так предпросмотр = то, что скачается.
//
// Тестовый эндпоинт для оценки связки. В прод-поток не подключён.

const MAX_DOCX_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { docxBase64?: string; instruction?: string; mode?: 'edit' | 'rewrite' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const { docxBase64, instruction, mode = 'edit' } = body
  if (!docxBase64 || !instruction?.trim()) {
    return NextResponse.json({ error: 'Нужны docxBase64 и instruction' }, { status: 400 })
  }

  const buffer = Buffer.from(docxBase64, 'base64')
  if (buffer.byteLength > MAX_DOCX_BYTES) {
    return NextResponse.json({ error: 'Файл слишком большой' }, { status: 413 })
  }

  try {
    // 1) .docx → HTML (тот же парсер, что при загрузке)
    const mammoth = await import('mammoth')
    const { value: html } = await mammoth.convertToHtml({ buffer })
    if (!html || !html.replace(/<[^>]*>/g, '').trim()) {
      return NextResponse.json({ error: 'В документе не найден текст' }, { status: 422 })
    }

    // 2) ИИ-правка через наш существующий движок editDocument
    const settings: AISettings = {
      protectionLevel: 70,
      targetSize: 8000,
      customInstruction: '',
    }
    const instr = mode === 'rewrite'
      ? `Полностью переработай этот договор по заданию, сохранив корректную юридическую структуру: ${instruction}`
      : instruction

    let edited = ''
    await runWithAI('edit', { userId }, async (provider) => {
      for await (const chunk of provider.editDocument(html, instr, settings)) {
        edited = chunk
      }
    })

    if (!edited || edited === '__EDIT_FAILED__') {
      return NextResponse.json({ error: 'ИИ не смог применить правку — переформулируйте задание' }, { status: 422 })
    }

    // 3) Итоговый HTML → .docx (тот же конвертер, что при скачивании) → предпросмотр = скачивание
    const docx = await convertToDocx(edited, { title: 'Документ' })
    return NextResponse.json({ docxBase64: docx.toString('base64') })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Ошибка обработки: ${msg}` }, { status: 500 })
  }
}
