/**
 * DocumentFormatter
 * Преобразует plain text документов в отформатированный DOCX
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
  BorderStyle,
  WidthType,
  AlignmentType,
  HeadingLevel,
} from 'docx';
import * as fs from 'fs';

interface FormattingRules {
  bold?: string[];          // ключевые слова для жирного выделения
  italic?: string[];        // для курсива
  fontSize?: { text: string; size: number }[];  // размер шрифта
}

interface DocumentMetadata {
  contractNumber?: string;
  contractDate?: string;
  city?: string;
  customerName?: string;
  customerDetails?: string;
  executorName?: string;
  executorDetails?: string;
  [key: string]: any;
}

export class DocumentFormatter {
  /**
   * Форматирует plain text договора в DOCX
   * @param plainText - исходный текст договора
   * @param metadata - метаданные (реквизиты, номер и т.д.)
   * @param customRules - пользовательские правила форматирования
   * @returns Buffer с DOCX содержимым
   */
  static async formatDocument(
    plainText: string,
    metadata: DocumentMetadata = {},
    customRules?: FormattingRules
  ): Promise<Buffer> {
    // Парсим структуру документа
    const structure = DocumentFormatter.parseDocumentStructure(plainText);

    // Создаём содержимое DOCX
    const sections = DocumentFormatter.createDocumentSections(
      structure,
      metadata,
      customRules
    );

    // Генерируем DOCX
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,      // 1 inch
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          children: sections,
        },
      ],
    });

    // Упаковываем в буфер
    return await Packer.toBuffer(doc);
  }

  /**
   * Парсит структуру документа из plain text
   * Выделяет заголовки, разделы, пункты
   */
  private static parseDocumentStructure(text: string) {
    const lines = text.split('\n');
    const structure: any[] = [];
    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Заголовок договора (всё заглавные буквы)
      if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) {
        if (currentSection) structure.push(currentSection);
        currentSection = {
          type: 'heading',
          level: 1,
          text: trimmed,
          content: [],
        };
      }
      // Заголовок раздела (Цифра. ТЕКСТ)
      else if (/^\d+\.\s+[А-Z]/i.test(trimmed)) {
        if (currentSection && currentSection.type === 'section') {
          structure.push(currentSection);
        }
        currentSection = {
          type: 'section',
          text: trimmed,
          content: [],
        };
      }
      // Подпункт (цифра.цифра)
      else if (/^\d+\.\d+\.\s+/i.test(trimmed)) {
        if (currentSection) {
          currentSection.content.push({
            type: 'subsection',
            text: trimmed,
          });
        }
      }
      // Обычный текст
      else {
        if (currentSection) {
          currentSection.content.push({
            type: 'text',
            text: trimmed,
          });
        }
      }
    }

    if (currentSection) structure.push(currentSection);
    return structure;
  }

  /**
   * Создаёт параграфы для DOCX на основе структуры
   */
  private static createDocumentSections(
    structure: any[],
    metadata: DocumentMetadata,
    customRules?: FormattingRules
  ): Paragraph[] {
    const sections: Paragraph[] = [];

    // Добавляем заголовок
    sections.push(
      DocumentFormatter.createTitle(metadata.contractNumber, metadata.contractDate, metadata.city)
    );

    // Добавляем реквизиты сторон
    sections.push(
      DocumentFormatter.createPartiesTable(metadata)
    );

    sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));

    // Добавляем основной контент
    for (const item of structure) {
      if (item.type === 'heading') {
        sections.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            text: item.text,
            spacing: { before: 200, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: item.text,
                bold: true,
                size: 24, // 12pt
                font: 'IBM Plex Sans',
              }),
            ],
          })
        );
      } else if (item.type === 'section') {
        sections.push(
          new Paragraph({
            text: item.text,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: item.text,
                bold: true,
                size: 22, // 11pt
                font: 'IBM Plex Sans',
              }),
            ],
          })
        );

        // Добавляем контент раздела
        for (const content of item.content) {
          if (content.type === 'subsection') {
            sections.push(
              new Paragraph({
                text: content.text,
                spacing: { before: 100, after: 100 },
                indent: { left: 720 }, // отступ слева
                children: [
                  new TextRun({
                    text: content.text,
                    size: 20, // 10pt
                    font: 'IBM Plex Sans',
                  }),
                ],
              })
            );
          } else {
            sections.push(
              new Paragraph({
                text: content.text,
                spacing: { line: 360, after: 100 }, // 1.5 line spacing
                children: [
                  new TextRun({
                    text: content.text,
                    size: 20,
                    font: 'IBM Plex Sans',
                  }),
                ],
              })
            );
          }
        }
      }
    }

    return sections;
  }

  /**
   * Создаёт заголовок документа
   */
  private static createTitle(
    number?: string,
    date?: string,
    city?: string
  ): Paragraph {
    const titleText = 'ДОГОВОР';
    const subtitle = `${number ? `№ ${number}` : ''} ${date ? `от ${date}` : ''}`.trim();

    return new Paragraph({
      text: `${titleText}\n${subtitle}\n${city || 'г. Москва'}`,
      spacing: { after: 200, line: 240 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: titleText,
          bold: true,
          size: 28, // 14pt
          font: 'Source Serif 4',
        }),
      ],
    });
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
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  text: 'ЗАКАЗЧИК',
                  children: [
                    new TextRun({
                      text: 'ЗАКАЗЧИК',
                      bold: true,
                      size: 20,
                      font: 'IBM Plex Sans',
                    }),
                  ],
                }),
                new Paragraph({
                  text: metadata.customerName || '',
                  spacing: { before: 100 },
                  children: [
                    new TextRun({
                      text: metadata.customerName || '',
                      size: 18,
                      font: 'IBM Plex Mono',
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  text: 'ИСПОЛНИТЕЛЬ',
                  children: [
                    new TextRun({
                      text: 'ИСПОЛНИТЕЛЬ',
                      bold: true,
                      size: 20,
                      font: 'IBM Plex Sans',
                    }),
                  ],
                }),
                new Paragraph({
                  text: metadata.executorName || '',
                  spacing: { before: 100 },
                  children: [
                    new TextRun({
                      text: metadata.executorName || '',
                      size: 18,
                      font: 'IBM Plex Mono',
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  /**
   * Применяет кастомные правила форматирования
   * (жирное, курсив, размер шрифта и т.д.)
   */
  static applyCustomFormatting(
    text: string,
    rules: FormattingRules
  ): TextRun[] {
    const runs: TextRun[] = [];
    let remaining = text;

    // Базовая реализация - полнофункциональный парсер требуется для production
    runs.push(
      new TextRun({
        text,
        size: 20,
        font: 'IBM Plex Sans',
      })
    );

    return runs;
  }
}

/**
 * Интеграция: используется в BullMQ воркере после генерации текста ИИ
 *
 * Пример использования в воркере:
 *
 * const formattedBuffer = await DocumentFormatter.formatDocument(
 *   fullText,
 *   {
 *     contractNumber: '01/2026',
 *     contractDate: '01.01.2026',
 *     city: 'Москва',
 *     customerName: 'ООО "Ромашка"',
 *     executorName: 'ИП Клевер',
 *   }
 * );
 *
 * // Сохраняем в Base64 для хранения в БД
 * version.formattedContent = formattedBuffer.toString('base64');
 * version.formattingApplied = true;
 */
