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
  supply: ['ГК РФ'],
  services: ['ГК РФ'],
  work: ['ГК РФ'],
  lease: ['ГК РФ'],
  sale: ['ГК РФ'],
  loan: ['ГК РФ'],
  employment: ['ТК РФ', 'ГК РФ'],
  gph: ['ГК РФ', '422-ФЗ'],
  agency: ['ГК РФ'],
  ip_license: ['ГК РФ'],
  consumer: ['ЗоЗПП', 'ГК РФ'],
  procurement: ['44-ФЗ', '223-ФЗ', 'ГК РФ'],
}

const BASE_ACTS = ['ГК РФ']

/** Акты для типа договора. Неизвестный/пустой тип → только базовые. */
export function actsForContractType(type: string | null | undefined): string[] {
  if (!type) return [...BASE_ACTS]
  const mapped = CONTRACT_TYPE_ACTS[type as ContractType]
  return mapped ? [...mapped] : [...BASE_ACTS]
}
