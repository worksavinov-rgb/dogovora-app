/**
 * Конвертирует HTML из mammoth в читаемый plain text.
 * Таблицы → tab-separated строки (одна строка таблицы = одна строка текста).
 */
export function htmlToPlainText(html: string): string {
  let text = html

  // 1. Строки таблицы → перенос строки
  text = text.replace(/<\/tr>/gi, '\n')
  // 2. Закрытие ячеек → табуляция (разделитель столбцов)
  text = text.replace(/<\/td>|<\/th>/gi, '\t')
  // 3. Элементы списка → маркер + перенос
  text = text.replace(/<li[^>]*>/gi, '• ')
  text = text.replace(/<\/li>/gi, '\n')
  // 4. Параграфы и заголовки → перенос
  text = text.replace(/<\/h[1-6]>/gi, '\n\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n')
  // 5. Удаляем все оставшиеся теги
  text = text.replace(/<[^>]+>/g, '')
  // 6. Декодируем HTML-энтити
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  // 7. Схлопываем \n\t → \t (параграф внутри ячейки таблицы не должен разрывать строку)
  text = text.replace(/\n(\t)/g, '$1')
  // 8. Убираем лишние пробелы, чистим строки
  text = text.replace(/[ ]{2,}/g, ' ')
  text = text.split('\n').map((l) => l.trim()).join('\n')
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}

export function isHtmlString(s: string): boolean {
  return /<(p|ul|ol|li|table|tr|td|th|strong|em|h[1-6]|br|div|span)[^>]*>/i.test(s.slice(0, 2000))
}
