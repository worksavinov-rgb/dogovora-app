// Маппинг «тип договора → релевантные акты (shortName)». Пред-фильтр для ретривера.
// ГК РФ входит всегда — это база любого договора.

export type ContractType =
  | 'supply' // поставка
  | 'services' // возмездное оказание услуг
  | 'work' // подряд
  | 'lease' // аренда
  | 'sale' // купля-продажа
  | 'loan' // заём
  | 'employment' // трудовой
  | 'gph' // ГПХ с физлицом/самозанятым
  | 'agency' // агентский/поручение/комиссия
  | 'ip_license' // лицензия/ИС
  | 'consumer' // с потребителем
  | 'procurement' // госзакупки

export const CONTRACT_TYPE_ACTS: Record<ContractType, string[]> = {
  supply: ['ГК РФ', '402-ФЗ', '173-ФЗ'],
  services: ['ГК РФ', '402-ФЗ'],
  work: ['ГК РФ', '402-ФЗ'],
  lease: ['ГК РФ', '402-ФЗ'],
  sale: ['ГК РФ', 'ЗоЗПП', '402-ФЗ'],
  loan: ['ГК РФ', '173-ФЗ', 'НК РФ'],
  employment: ['ТК РФ', 'ГК РФ', '152-ФЗ'],
  gph: ['ГК РФ', '422-ФЗ', '152-ФЗ', 'НК РФ'],
  agency: ['ГК РФ', '14-ФЗ (ООО)', '208-ФЗ (АО)'],
  ip_license: ['ГК РФ', '38-ФЗ'],
  consumer: ['ЗоЗПП', 'ГК РФ', '152-ФЗ', '38-ФЗ'],
  procurement: ['44-ФЗ', '223-ФЗ', 'ГК РФ', 'НК РФ'],
}

const BASE_ACTS = ['ГК РФ']

/** Акты для типа договора. Неизвестный/пустой тип → только базовые. */
export function actsForContractType(type: string | null | undefined): string[] {
  if (!type) return [...BASE_ACTS]
  const mapped = CONTRACT_TYPE_ACTS[type as ContractType]
  return mapped ? [...mapped] : [...BASE_ACTS]
}

/** Известен ли тип договора. Неизвестный не должен молча сужать поиск. */
export function isKnownContractType(type: string | null | undefined): boolean {
  return !!type && Object.prototype.hasOwnProperty.call(CONTRACT_TYPE_ACTS, type)
}
