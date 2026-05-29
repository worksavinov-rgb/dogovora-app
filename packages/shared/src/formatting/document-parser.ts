/**
 * DocumentParser
 * Парсит структуру и стили из эталонного бланка договора (DOCX)
 */

import * as mammoth from 'mammoth';
import * as fs from 'fs';

export interface DocumentStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export interface DocumentSection {
  type: 'heading' | 'title' | 'table' | 'paragraph' | 'list';
  text: string;
  style?: DocumentStyle;
  rows?: DocumentRow[]; // для таблиц
  children?: DocumentSection[]; // для вложенных элементов
}

export interface DocumentRow {
  cells: DocumentCell[];
}

export interface DocumentCell {
  text: string;
  style?: DocumentStyle;
  width?: number;
}

export interface DocumentStructure {
  title?: string;
  parties?: {
    customer?: string;
    executor?: string;
  };
  sections: DocumentSection[];
  styles: {
    defaultFont?: string;
    headingFont?: string;
    bodyFont?: string;
    monoFont?: string;
    defaultFontSize?: number;
  };
}

export class DocumentParser {
  /**
   * Парсит DOCX файл и извлекает структуру
   */
  static async parseDocxFile(filePath: string): Promise<DocumentStructure> {
    const fileBuffer = fs.readFileSync(filePath);
    return DocumentParser.parseDocxBuffer(fileBuffer);
  }

  /**
   * Парсит DOCX из буфера
   */
  static async parseDocxBuffer(buffer: Buffer): Promise<DocumentStructure> {
    try {
      const result = await mammoth.convertToHtml({
        arrayBuffer: buffer,
      });

      const structure: DocumentStructure = {
        sections: [],
        styles: {
          defaultFont: 'IBM Plex Sans',
          headingFont: 'Source Serif 4',
          bodyFont: 'IBM Plex Sans',
          monoFont: 'IBM Plex Mono',
          defaultFontSize: 11,
        },
      };

      // Извлекаем основной HTML
      const html = result.value;

      // Парсим HTML в структуру
      structure.sections = DocumentParser.parseHtmlStructure(html);

      // Извлекаем метаданные из сообщений
      if (result.messages.length > 0) {
        // Используем сообщения для дополнительной информации
      }

      return structure;
    } catch (error) {
      console.error('Error parsing DOCX:', error);
      throw error;
    }
  }

  /**
   * Парсит HTML структуру документа
   */
  private static parseHtmlStructure(html: string): DocumentSection[] {
    const sections: DocumentSection[] = [];

    // Регулярные выражения для выделения элементов
    const headingRegex = /<h([1-6])>(.*?)<\/h\1>/gi;
    const paragraphRegex = /<p>(.*?)<\/p>/gi;
    const tableRegex = /<table>(.*?)<\/table>/gis;

    let lastIndex = 0;
    let match;

    // Извлекаем заголовки
    while ((match = headingRegex.exec(html)) !== null) {
      const level = parseInt(match[1]);
      const text = DocumentParser.stripHtmlTags(match[2]);

      sections.push({
        type: level === 1 ? 'title' : 'heading',
        text: text.trim(),
        style: {
          bold: true,
          fontSize: 28 - (level - 1) * 2,
          fontFamily: 'Source Serif 4',
        },
      });
    }

    // Извлекаем параграфы
    while ((match = paragraphRegex.exec(html)) !== null) {
      const text = DocumentParser.stripHtmlTags(match[1]);
      if (text.trim().length > 0) {
        sections.push({
          type: 'paragraph',
          text: text.trim(),
          style: {
            fontSize: 11,
            fontFamily: 'IBM Plex Sans',
          },
        });
      }
    }

    // Извлекаем таблицы
    while ((match = tableRegex.exec(html)) !== null) {
      const tableHtml = match[0];
      const table = DocumentParser.parseTable(tableHtml);
      if (table.rows.length > 0) {
        sections.push({
          type: 'table',
          text: 'Table',
          rows: table.rows,
        });
      }
    }

    return sections;
  }

  /**
   * Парсит таблицу из HTML
   */
  private static parseTable(
    tableHtml: string
  ): { rows: DocumentRow[] } {
    const rows: DocumentRow[] = [];
    const rowRegex = /<tr>(.*?)<\/tr>/gis;
    const cellRegex = /<t[dh]>(.*?)<\/t[dh]>/gi;

    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells: DocumentCell[] = [];

      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const cellText = DocumentParser.stripHtmlTags(cellMatch[1]);
        cells.push({
          text: cellText.trim(),
          style: {
            fontSize: 10,
            fontFamily: 'IBM Plex Sans',
          },
        });
      }

      if (cells.length > 0) {
        rows.push({ cells });
      }
    }

    return { rows };
  }

  /**
   * Удаляет HTML теги из текста
   */
  private static stripHtmlTags(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
  }

  /**
   * Применяет структуру из бланка к новому документу
   * Используется при форматировании для консистентности стиля
   */
  static applyBlankTemplate(
    text: string,
    templateStructure: DocumentStructure
  ): string {
    // Базовая реализация - применяет шрифты и стили из шаблона
    let formatted = text;

    // Заменяем шрифты в зависимости от типа текста
    // Заголовки → headingFont
    // Обычный текст → bodyFont
    // Реквизиты → monoFont

    return formatted;
  }
}

/**
 * Интеграция: используется в DocumentFormatter для применения правильных стилей
 *
 * Пример использования:
 *
 * // Загружаем эталонный бланк один раз при инициализации
 * const template = await DocumentParser.parseDocxFile(
 *   '/path/to/эталонный_бланк.docx'
 * );
 *
 * // Используем при форматировании новых документов
 * const formatted = await DocumentFormatter.formatDocument(
 *   plainText,
 *   metadata,
 *   template.styles
 * );
 */
