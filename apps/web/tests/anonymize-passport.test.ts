import { describe, it, expect } from 'vitest'
import { maskPartyForAI } from '@/lib/anonymize'

describe('maskPartyForAI — паспортные поля', () => {
  it('серия/номер/кем выдан/дата/код и НПД маскируются', () => {
    const masked = maskPartyForAI({
      name: 'Иванов Иван',
      passportSeries: '1234', passportNumber: '567890',
      passportIssuedBy: 'ОВД', passportIssueDate: '10.05.2015',
      passportDeptCode: '770-053', npdRegisteredDate: '01.01.2024',
    })!
    expect(masked.passportSeries).toBe('[PASSPORTSERIES]')
    expect(masked.passportNumber).toBe('[PASSPORTNUMBER]')
    expect(masked.passportIssuedBy).toBe('[PASSPORTISSUEDBY]')
    expect(masked.passportIssueDate).toBe('[PASSPORTISSUEDATE]')
    expect(masked.passportDeptCode).toBe('[PASSPORTDEPTCODE]')
    expect(masked.npdRegisteredDate).toBe('[NPDREGISTEREDDATE]')
    expect(masked.name).toBe('Иванов Иван') // имя маскируется отдельным механизмом
  })
})
