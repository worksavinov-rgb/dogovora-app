import { describe, it, expect } from 'vitest'
import { actsForContractType, isKnownContractType, CONTRACT_TYPE_ACTS } from '../src/lib/legal/contract-types'
import { CORE_ACTS } from '../src/lib/legal/core-acts'

describe('маппинг типов договоров на акты', () => {
  it('каждый акт из маппинга существует в реестре отслеживаемых актов', () => {
    // Ссылка на акт, которого нет в CORE_ACTS, означала бы пред-фильтр,
    // не находящий ничего никогда.
    const known = new Set(CORE_ACTS.map((a) => a.shortName))
    const unknown: string[] = []
    for (const acts of Object.values(CONTRACT_TYPE_ACTS)) {
      for (const a of acts) if (!known.has(a)) unknown.push(a)
    }
    expect(unknown).toEqual([])
  })

  it('каждый отслеживаемый акт достижим хотя бы из одного типа договора', () => {
    // Иначе мы мониторим поправки к акту, нормы которого поиск никогда не вернёт.
    const reachable = new Set(Object.values(CONTRACT_TYPE_ACTS).flat())
    const orphans = CORE_ACTS.map((a) => a.shortName).filter((s) => !reachable.has(s))
    expect(orphans).toEqual([])
  })

  it('трудовой договор тянет ТК', () => {
    expect(actsForContractType('employment')).toContain('ТК РФ')
  })

  it('ГК есть в любом типе договора — это база любой сделки', () => {
    for (const type of Object.keys(CONTRACT_TYPE_ACTS)) {
      expect(actsForContractType(type)).toContain('ГК РФ')
    }
  })

  it('неизвестный и пустой тип не считаются известными', () => {
    expect(isKnownContractType('supply')).toBe(true)
    expect(isKnownContractType('suply')).toBe(false)
    expect(isKnownContractType(null)).toBe(false)
    expect(isKnownContractType(undefined)).toBe(false)
  })

  it('не наследует свойства Object.prototype как тип договора', () => {
    expect(isKnownContractType('toString')).toBe(false)
    expect(isKnownContractType('constructor')).toBe(false)
  })
})
