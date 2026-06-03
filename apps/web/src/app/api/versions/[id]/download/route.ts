import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { DocumentFormatter } from '@shared/formatting/document-formatter'

type Params = { params: Promise<{ id: string }> }

// GET /api/versions/:id/download
// Скачивание DOCX. Доступно только для оплаченных версий.
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    include: {
      document: {
        select: {
          title: true,
          number: true,
          counterparty: {
            include: {
              bankDetails: { take: 1 },
              signatories: { where: { isDefault: true }, take: 1 },
            },
          },
          profile: { include: { bankDetails: { take: 1 } } },
        },
      },
      purchase: true,
    },
  })

  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Проверяем оплату
  if (!version.purchase) {
    return NextResponse.json({ error: 'Версия не оплачена. Для скачивания необходимо купить версию.' }, { status: 403 })
  }

  if (!version.content) {
    return NextResponse.json({ error: 'Документ ещё не сгенерирован' }, { status: 400 })
  }

  let docxBuffer: Buffer

  try {
    const aiSettings = version.aiSettings as { userRole?: string } | null

    docxBuffer = await DocumentFormatter.formatDocument(version.content, {
      contractNumber: version.document.number ?? undefined,
      contractDate: new Date(version.createdAt).toLocaleDateString('ru-RU'),
      city: 'Москва',
      myRole: aiSettings?.userRole === 'executor' ? 'Исполнитель' : 'Заказчик',
      myParty: version.document.profile ? {
        name: version.document.profile.name,
        type: version.document.profile.type,
        inn: version.document.profile.inn,
        kpp: version.document.profile.kpp,
        ogrn: version.document.profile.ogrn,
        legalAddress: version.document.profile.legalAddress,
        email: null,
        signatorName: version.document.profile.signatorName,
        signatorPosition: version.document.profile.signatorPosition,
        bank: version.document.profile.bankDetails[0] ?? null,
      } : undefined,
      counterparty: version.document.counterparty ? {
        name: version.document.counterparty.name,
        type: version.document.counterparty.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR',
        inn: version.document.counterparty.inn,
        kpp: version.document.counterparty.kpp,
        ogrn: version.document.counterparty.ogrn,
        legalAddress: version.document.counterparty.legalAddress,
        email: version.document.counterparty.email,
        signatorName: version.document.counterparty.signatories[0]?.fullName ?? null,
        signatorPosition: version.document.counterparty.signatories[0]?.position ?? null,
        bank: version.document.counterparty.bankDetails[0] ?? null,
      } : undefined,
    })
  } catch (err) {
    console.error('[download] Formatter error:', err)
    return NextResponse.json({ error: 'Ошибка создания файла' }, { status: 500 })
  }

  // Формируем имя файла
  const safeTitle = (version.document.title ?? 'договор')
    .replace(/[^\wА-яЁё\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  const filename = `${safeTitle}_v${version.number}.docx`

  // Копируем буфер в собственный ArrayBuffer (BodyInit принимает ArrayBuffer)
  const arrayBuffer = docxBuffer.buffer.slice(docxBuffer.byteOffset, docxBuffer.byteOffset + docxBuffer.byteLength)

  return new NextResponse(arrayBuffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(docxBuffer.length),
    },
  })
}
