// Реестр актов ядра юрбазы — что отслеживаем в API pravo.gov.ru.
//
// number здесь СПРАВОЧНЫЙ: номера ФЗ переиспользуются каждый год, опознать акт по
// номеру нельзя (14-ФЗ — это и ГК ч.2 1996 года, и закон об ООО 1998 года).
// Рабочий признак — matchPatterns: фрагменты официального названия, которые
// встречаются в названии закона-поправки («О внесении изменений в …»).

export type CoreActKind = 'CODE' | 'FEDERAL_LAW' | 'LAW_RF'

export interface CoreAct {
  shortName: string
  number: string
  kind: CoreActKind
  title: string
  /** Регулярные выражения с допуском на склонение (кодексы склоняются в названиях поправок). */
  matchPatterns: string[]
}

export const CORE_ACTS: CoreAct[] = [
  {
    shortName: 'ГК РФ', number: '51-ФЗ', kind: 'CODE',
    title: 'Гражданский кодекс Российской Федерации',
    matchPatterns: ['гражданск[а-яё]*\\s+кодекс[а-яё]*'],
  },
  {
    shortName: 'ТК РФ', number: '197-ФЗ', kind: 'CODE',
    title: 'Трудовой кодекс Российской Федерации',
    matchPatterns: ['трудов[а-яё]*\\s+кодекс[а-яё]*'],
  },
  {
    shortName: 'НК РФ', number: '146-ФЗ', kind: 'CODE',
    title: 'Налоговый кодекс Российской Федерации',
    matchPatterns: ['налогов[а-яё]*\\s+кодекс[а-яё]*'],
  },
  {
    shortName: 'ЗоЗПП', number: '2300-1', kind: 'LAW_RF',
    title: 'Закон Российской Федерации «О защите прав потребителей»',
    matchPatterns: ['о защите прав потребителей'],
  },
  {
    shortName: '152-ФЗ', number: '152-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О персональных данных»',
    matchPatterns: ['о персональных данных'],
  },
  {
    shortName: '44-ФЗ', number: '44-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О контрактной системе в сфере закупок товаров, работ, услуг для обеспечения государственных и муниципальных нужд»',
    matchPatterns: ['о контрактной системе в сфере закупок'],
  },
  {
    shortName: '223-ФЗ', number: '223-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О закупках товаров, работ, услуг отдельными видами юридических лиц»',
    matchPatterns: ['о закупках товаров, работ, услуг отдельными видами'],
  },
  {
    shortName: '422-ФЗ', number: '422-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О проведении эксперимента по установлению специального налогового режима „Налог на профессиональный доход“»',
    matchPatterns: ['налог[а-яё]*\\s+на профессиональный доход'],
  },
  {
    shortName: '14-ФЗ (ООО)', number: '14-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «Об обществах с ограниченной ответственностью»',
    matchPatterns: ['об обществах с ограниченной ответственностью'],
  },
  {
    shortName: '208-ФЗ (АО)', number: '208-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «Об акционерных обществах»',
    matchPatterns: ['об акционерных обществах'],
  },
  {
    shortName: '38-ФЗ', number: '38-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О рекламе»',
    matchPatterns: ['о рекламе'],
  },
  {
    shortName: '402-ФЗ', number: '402-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О бухгалтерском учете»',
    matchPatterns: ['о бухгалтерском уч[её]те'],
  },
  {
    shortName: '173-ФЗ', number: '173-ФЗ', kind: 'FEDERAL_LAW',
    title: 'Федеральный закон «О валютном регулировании и валютном контроле»',
    matchPatterns: ['о валютном регулировании'],
  },
]

export function coreActByShortName(shortName: string): CoreAct | undefined {
  return CORE_ACTS.find((a) => a.shortName === shortName)
}
