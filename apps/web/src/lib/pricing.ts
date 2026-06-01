/**
 * Расчёт стоимости покупки версии документа.
 * docType: 'CONTRACT' | 'APPENDIX' | 'AMENDMENT'
 * chars: количество знаков в тексте версии
 */
export function calcVersionPrice(docType: string, chars: number): number {
  if (docType === 'CONTRACT') {
    if (chars <= 20_000) return 50
    if (chars <= 40_000) return 60
    return 100
  }

  if (docType === 'APPENDIX') {
    return chars <= 20_000 ? 50 : 100
  }

  if (docType === 'AMENDMENT') {
    return chars <= 20_000 ? 40 : 100
  }

  // Неизвестный тип — базовая цена
  return 50
}
