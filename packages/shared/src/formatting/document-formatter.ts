/**
 * DocumentFormatter
 * Преобразует plain text договоров в отформатированный DOCX
 * на основе эталонного бланка договора
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
  HeadingLevel,
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
  customerName?: string
  customerDetails?: string
  executorName?: string
  executorDetails?: string
  [key: string]: unknown
}

interface DocSection {
  type: string
  level?: number
  text: string
  content: Array<{ type: string; text: string }>
}

export class DocumentFormatter {
  /**
   * Форматирует plain text договора в DOCX
   */
  static async formatDocument(
    plainText: string,
    metadata: DocumentMetadata = {},
    customRules?: FormattingRules
  ): Promise<Buffer> {
    const structure = DocumentFormatter.parseDocumentStructure(plainText)
    const children = DocumentFormatter.createDocumentChildren(structure, metadata, customRules)

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1134,   // ~2 cm
                right: 850,  // ~1.5 cm
                bottom: 1134,
                left: 1700,  // ~3 cm (ГОСТ поле)
              },
            },
          },
          children,
        },
      ],
    })

    return await Packer.toBuffer(doc)
  }

  /**
   * Парсит структуру документа из plain text
   */
  private static parseDocumentStructure(text: string): DocSection[] {
    const lines = text.split('\n')
    const structure: DocSection[] = []
    let currentSection: DocSection | null = null

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Заголовок договора (все заглавные буквы, > 3 символов)
      if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && /[А-ЯA-Z]/.test(trimmed)) {
        if (currentSection) structure.push(currentSection)
        currentSection = { type: 'heading', level: 1, text: trimmed, content: [] }
      }
      // Заголовок раздела (Цифра. ТЕКСТ)
      else if (/^\d+\.\s+\S/.test(trimmed)) {
        if (currentSection && currentSection.type === 'section') {
          structure.push(currentSection)
        }
        currentSection = { type: 'section', text: trimmed, content: [] }
      }
      // Подпункт (цифра.цифра.текст)
      else if (/^\d+\.\d+[\.\s]/.test(trimmed)) {
        if (currentSection) {
          currentSection.content.push({ type: 'subsection', text: trimmed })
        } else {
          structure.push({ type: 'text', text: trimmed, content: [] })
        }
      }
      // Обычный текст
      else {
        if (currentSection) {
          currentSection.content.push({ type: 'text', text: trimmed })
        } else {
          structure.push({ type: 'text', text: trimmed, content: [] })
        }
      }
    }

    if (currentSection) structure.push(currentSection)
    return structure
  }

  /**
   * Создаёт children для секции DOCX (Paragraph | Table)
   */
  private static createDocumentChildren(
    structure: DocSection[],
    metadata: DocumentMetadata,
    _customRules?: FormattingRules
  ): (Paragraph | Table)[] {
    const children: (Paragraph | Table)[] = []

    // Заголовок документа
    children.push(DocumentFormatter.createTitle(metadata.contractNumber, metadata.contractDate, metadata.city))

    // Пустая строка после заголовка
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }))

    // Таблица реквизитов (если есть данные сторон)
    if (metadata.customerName || metadata.executorName) {
      children.push(DocumentFormatter.createPartiesTable(metadata))
      children.push(new Paragraph({ text: '', spacing: { after: 200 } }))
    }

    // Основной контент
    for (const item of structure) {
      if (item.type === 'heading') {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 200 },
            children: [
              new TextRun({ text: item.text, bold: true, size: 26, font: 'IBM Plex Sans' }),
            ],
          })
        )
      } else if (item.type === 'section') {
        children.push(
          new Paragraph({
            spacing: { before: 280, after: 120 },
            children: [
              new TextRun({ text: item.text, bold: true, size: 22, font: 'IBM Plex Sans' }),
            ],
          })
        )

        for (const c of item.content) {
          if (c.type === 'subsection') {
            children.push(
              new Paragraph({
                spacing: { before: 80, after: 80 },
                indent: { left: 720 },
                children: [
                  new TextRun({ text: c.text, size: 20, font: 'IBM Plex Sans' }),
                ],
              })
            )
          } else {
            children.push(
              new Paragraph({
                spacing: { line: 360, after: 100 },
                children: [
                  new TextRun({ text: c.text, size: 20, font: 'IBM Plex Sans' }),
                ],
              })
            )
          }
        }
      } else {
        children.push(
          new Paragraph({
            spacing: { line: 360, after: 100 },
            children: [
              new TextRun({ text: item.text, size: 20, font: 'IBM Plex Sans' }),
            ],
          })
        )
      }
    }

    return children
  }

  /**
   * Создаёт заголовок документа
   */
  private static createTitle(number?: string, date?: string, city?: string): Paragraph {
    const subtitle = [number ? `№ ${number}` : '', date ? `от ${date} г.` : '']
      .filter(Boolean)
      .join(' ')

    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 200, line: 320 },
      children: [
        new TextRun({ text: 'ДОГОВОР', bold: true, size: 28, font: 'Source Serif 4', break: 0 }),
        ...(subtitle ? [new TextRun({ text: subtitle, size: 22, font: 'IBM Plex Sans', break: 1 })] : []),
        new TextRun({
          text: city ? `г. ${city}` : 'г. Москва',
          size: 20,
          font: 'IBM Plex Sans',
          break: 1,
        }),
      ],
    })
  }

  /**
   * Создаёт таблицу реквизитов (Заказчик ↔ Исполнитель)
   */
  private static createPartiesTable(metadata: DocumentMetadata): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { top: 100, bottom: 100, left: 100, right: 200 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'ЗАКАЗЧИК', bold: true, size: 20, font: 'IBM Plex Sans' })],
                }),
                ...(metadata.customerName
                  ? [new Paragraph({
                      spacing: { before: 80 },
                      children: [new TextRun({ text: String(metadata.customerName), size: 18, font: 'IBM Plex Mono' })],
                    })]
                  : []),
                ...(metadata.customerDetails
                  ? [new Paragraph({
                      children: [new TextRun({ text: String(metadata.customerDetails), size: 16, font: 'IBM Plex Mono', color: '666666' })],
                    })]
                  : []),
              ],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { top: 100, bottom: 100, left: 200, right: 100 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'ИСПОЛНИТЕЛЬ', bold: true, size: 20, font: 'IBM Plex Sans' })],
                }),
                ...(metadata.executorName
                  ? [new Paragraph({
                      spacing: { before: 80 },
                      children: [new TextRun({ text: String(metadata.executorName), size: 18, font: 'IBM Plex Mono' })],
                    })]
                  : []),
                ...(metadata.executorDetails
                  ? [new Paragraph({
                      children: [new TextRun({ text: String(metadata.executorDetails), size: 16, font: 'IBM Plex Mono', color: '666666' })],
                    })]
                  : []),
              ],
            }),
          ],
        }),
      ],
    })
  }

  /**
   * Применяет кастомные правила форматирования
   */
  static applyCustomFormatting(_text: string, _rules: FormattingRules): TextRun[] {
    return []
  }
}
