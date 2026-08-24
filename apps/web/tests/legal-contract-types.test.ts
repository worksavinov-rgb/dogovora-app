import { describe, it, expect } from 'vitest'
import { actsForContractType, CONTRACT_TYPE_ACTS } from '../src/lib/legal/contract-types'

describe('actsForContractType', () => {
  it('трудовой договор тянет ТК и ГК', () => {
    const acts = actsForContractType('employment')
    expect(acts).toContain('ТК РФ')
    expect(acts).toContain('ГК РФ')
  })

  it('поставка тянет ГК', () => {
    expect(actsForContractType('supply')).toContain('ГК РФ')
  })

  it('неизвестный тип → базовый ГК', () => {
    expect(actsForContractType('нечто-неизвестное')).toEqual(['ГК РФ'])
  })

  it('пустой тип → базовый ГК', () => {
    expect(actsForContractType(null)).toEqual(['ГК РФ'])
    expect(actsForContractType(undefined)).toEqual(['ГК РФ'])
  })

  it('каждый маппинг включает ГК РФ', () => {
    for (const acts of Object.values(CONTRACT_TYPE_ACTS)) {
      expect(acts).toContain('ГК РФ')
    }
  })
})
