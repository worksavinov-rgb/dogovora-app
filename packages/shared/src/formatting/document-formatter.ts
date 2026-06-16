/**
 * DocumentFormatter
 * Преобразует plain text договоров в отформатированный DOCX
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx'

export interface FormattingRules {
  bold?: string[]
  italic?: string[]
  fontSize?: { text: string; size: number }[]
}

export interface DocumentMetadata {
  contractNumber?: string
  contractDate?: string
  city?: string
  myRole?: string
  myParty?: {
    name: string
    type: string
    inn?: string | null
    kpp?: string | null
    ogrn?: string | null
    legalAddress?: string | null
    email?: string | null
    signatorName?: string | null
    signatorPosition?: string | null
    bank?: {
      bankName?: string | null
      checkingAccount?: string | null
      bik?: string | null
      correspondentAccount?: string | null
    } | null
  }
  counterparty?: {
    name: string
    type: string
    inn?: string | null
    kpp?: string | null
    ogrn?: string | null
    legalAddress?: string | null
    email?: string | null
    signatorName?: string | null
    signatorPosition?: string | null
    bank?: {
      bankName?: string | null
      checkingAccount?: string | null
      bik?: string | null
      correspondentAccount?: string | null
    } | null
  }
  [key: string]: unknown
}

type LineType = 'empty' | 'heading' | 'section' | 'subsection' | 'clause' | 'paragraph'

interface ParsedLine {
  type: LineType
  text: string
}

function stripMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      // Убираем ## / ### / #### в начале строки
      line = line.replace(/^#{2,}\s*/, '')
      // Убираем - и > в начале строки
      if (/^[->\s]+\s/.test(line)) {
        line = line.replace(/^[->\s]+/, '').trim()
      }
      // Убираем ** и *
      line = line.replace(/\*\*(.+?)\*\*/g, '$1')
      line = line.replace(/\*(.+?)\*/g, '$1')
      return line
    })
    .join('\n')
}

// Обрезаем текст на месте где ИИ начал добавлять реквизиты — система добавит их сама
function stripAIRequisites(text: string): string {
  const lines = text.split('\n')
  const cutPatterns = [
    /^РЕКВИЗИТЫ\s*(И\s*ПОДПИСИ)?\s*(СТОРОН)?/i,
    /^\d+\.\s*РЕКВИЗИТЫ\s*(И\s*ПОДПИСИ)?\s*(СТОРОН)?/i,
    /^Место\s+нахождения\s+и\s+банковские\s+реквизиты/i,
    /^\d+\.\s*Место\s+нахождения/i,
  ]
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.replace(/\*\*/g, '').replace(/\*/g, '').trim()
    if (cutPatterns.some(p => p.test(c))) {
      return lines.slice(0, i).join('\n').trimEnd()
    }
  }
  return text
}

// Определяем роль пользователя из текста преамбулы (надёжнее чем из настроек)
function detectUserRoleFromText(text: string, userName: string): string | null {
  if (!userName) return null
  const lines = text.split('\n').slice(0, 20) // Смотрим только первые 20 строк (преамбула)
  for (const line of lines) {
    if (line.includes(userName)) {
      if (/«Исполнитель»|"Исполнитель"/.test(line)) return 'Исполнитель'
      if (/«Заказчик»|"Заказчик"/.test(line)) return 'Заказчик'
    }
  }
  return null
}

function parseLines(text: string): ParsedLine[] {
  const cleaned = stripMarkdown(stripAIRequisites(text))
  const lines = cleaned.split('\n')
  const result: ParsedLine[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      result.push({ type: 'empty', text: '' })
      continue
    }

    // Три уровня нумерации: 1.1.1. или 1.1.1
    if (/^\d+\.\d+\.\d+\.?\s/.test(trimmed)) {
      result.push({ type: 'clause', text: trimmed })
      continue
    }

    // Два уровня нумерации: 1.1. или 1.1
    if (/^\d+\.\d+\.?\s/.test(trimmed)) {
      result.push({ type: 'subsection', text: trimmed })
      continue
    }

    // Один уровень нумерации: 1.
    if (/^\d+\.\s/.test(trimmed)) {
      result.push({ type: 'section', text: trimmed })
      continue
    }

    // Заголовок: только заглавные буквы, цифры, пробелы, длина > 3
    if (trimmed.length > 3 && trimmed === trimmed.toUpperCase() && /[А-ЯA-Z]/.test(trimmed)) {
      result.push({ type: 'heading', text: trimmed })
      continue
    }

    result.push({ type: 'paragraph', text: trimmed })
  }

  return result
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
}

function buildPartyParagraphs(party: NonNullable<DocumentMetadata['myParty']>, role: string): Paragraph[] {
  const paras: Paragraph[] = []

  paras.push(new Paragraph({
    children: [new TextRun({ text: role, bold: true, size: 20, font: 'Times New Roman' })],
    spacing: { after: 80 },
  }))

  paras.push(new Paragraph({
    children: [new TextRun({ text: party.name, bold: true, size: 20, font: 'Times New Roman' })],
    spacing: { after: 60 },
  }))

  if (party.legalAddress) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `Адрес: ${party.legalAddress}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.inn) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `ИНН: ${party.inn}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.kpp && party.type !== 'SOLE_PROPRIETOR') {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `КПП: ${party.kpp}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.ogrn) {
    const ogrnLabel = party.type === 'SOLE_PROPRIETOR' ? 'ОГРНИП' : 'ОГРН'
    paras.push(new Paragraph({
      children: [new TextRun({ text: `${ogrnLabel}: ${party.ogrn}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.bank?.checkingAccount) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `Р/счет: ${party.bank.checkingAccount}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.bank?.correspondentAccount) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `К/счет: ${party.bank.correspondentAccount}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.bank?.bankName) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `Банк: ${party.bank.bankName}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.bank?.bik) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `БИК: ${party.bank.bik}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }
  if (party.email) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `E-mail: ${party.email}`, size: 18, font: 'Times New Roman' })],
      spacing: { after: 40 },
    }))
  }

  // Строка подписи
  paras.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  if (party.signatorName) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: party.signatorName, size: 18, font: 'Times New Roman' })],
      spacing: { after: 20 },
    }))
  }
  paras.push(new Paragraph({
    children: [new TextRun({ text: '____________________', size: 18, font: 'Times New Roman' })],
    spacing: { after: 40 },
  }))
  if (party.signatorPosition) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: party.signatorPosition, size: 16, font: 'Times New Roman', color: '666666' })],
      spacing: { after: 40 },
    }))
  }

  return paras
}

export class DocumentFormatter {
  static async formatDocument(
    plainText: string,
    metadata: DocumentMetadata = {},
    _customRules?: FormattingRules
  ): Promise<Buffer> {
    const lines = parseLines(plainText)
    const children: (Paragraph | Table)[] = []

    // Заголовок документа
    const subtitle = [
      metadata.contractNumber ? `№ ${metadata.contractNumber}` : '',
      metadata.contractDate ? `от ${metadata.contractDate} г.` : '',
    ].filter(Boolean).join(' ')

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 200, line: 320 },
      children: [
        new TextRun({ text: 'ДОГОВОР', bold: true, size: 28, font: 'Times New Roman' }),
        ...(subtitle ? [new TextRun({ text: subtitle, size: 24, font: 'Times New Roman', break: 1 })] : []),
        new TextRun({
          text: metadata.city ? `г. ${metadata.city}` : 'г. Москва',
          size: 24,
          font: 'Times New Roman',
          break: 1,
        }),
      ],
    }))

    // Основной контент
    for (const line of lines) {
      if (line.type === 'empty') {
        children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
      } else if (line.type === 'heading') {
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 200 },
          children: [new TextRun({ text: line.text, bold: true, size: 24, font: 'Times New Roman' })],
        }))
      } else if (line.type === 'section') {
        children.push(new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 280, after: 120 },
          children: [new TextRun({ text: line.text, bold: true, size: 24, font: 'Times New Roman' })],
        }))
      } else if (line.type === 'subsection') {
        children.push(new Paragraph({
          indent: { left: 720 },
          spacing: { before: 80, after: 80 },
          children: [new TextRun({ text: line.text, size: 24, font: 'Times New Roman' })],
        }))
      } else if (line.type === 'clause') {
        children.push(new Paragraph({
          indent: { left: 1440 },
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text: line.text, size: 24, font: 'Times New Roman' })],
        }))
      } else {
        // paragraph
        children.push(new Paragraph({
          alignment: AlignmentType.BOTH,
          spacing: { line: 360, after: 100 },
          children: [new TextRun({ text: line.text, size: 24, font: 'Times New Roman' })],
        }))
      }
    }

    // Блок реквизитов в конце
    if (metadata.myParty && metadata.counterparty) {
      // Определяем роль из текста преамбулы (надёжнее чем из настроек)
      const detectedRole = detectUserRoleFromText(plainText, metadata.myParty.name)
      const myRole = detectedRole ?? metadata.myRole ?? 'Заказчик'
      const counterpartyRole = myRole === 'Исполнитель' ? 'Заказчик' : 'Исполнитель'

      // Разделитель
      children.push(new Paragraph({
        spacing: { before: 400, after: 200 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
        },
        text: '',
      }))

      // Заголовок блока реквизитов
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
        children: [new TextRun({ text: 'РЕКВИЗИТЫ И ПОДПИСИ СТОРОН', bold: true, size: 24, font: 'Times New Roman' })],
      }))

      const myParaChildren = buildPartyParagraphs(metadata.myParty, myRole)
      const cpParaChildren = buildPartyParagraphs(metadata.counterparty, counterpartyRole)

      const noBorderDef = {
        top: noBorder(),
        bottom: noBorder(),
        left: noBorder(),
        right: noBorder(),
        insideHorizontal: noBorder(),
        insideVertical: noBorder(),
      }

      children.push(new Table({
        width: { size: 9026, type: WidthType.DXA },
        borders: noBorderDef,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 4513, type: WidthType.DXA },
                borders: {
                  top: noBorder(),
                  bottom: noBorder(),
                  left: noBorder(),
                  right: noBorder(),
                },
                margins: { top: 80, bottom: 80, left: 0, right: 200 },
                children: myParaChildren,
              }),
              new TableCell({
                width: { size: 4513, type: WidthType.DXA },
                borders: {
                  top: noBorder(),
                  bottom: noBorder(),
                  left: noBorder(),
                  right: noBorder(),
                },
                margins: { top: 80, bottom: 80, left: 200, right: 0 },
                children: cpParaChildren,
              }),
            ],
          }),
        ],
      }))
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: {
                top: 1134,
                right: 850,
                bottom: 1134,
                left: 1701,
              },
            },
          },
          children,
        },
      ],
    })

    return await Packer.toBuffer(doc)
  }

  static applyCustomFormatting(_text: string, _rules: FormattingRules): TextRun[] {
    return []
  }
}
