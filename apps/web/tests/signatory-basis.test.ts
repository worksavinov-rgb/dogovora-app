// Основание полномочий подписанта своего юрлица.
//
// В Profile.signatorBasis лежит разнородное: свободный текст, вписанный
// человеком, и служебные коды, попавшие туда из бывшего раздела «Подписанты»
// (он записывал в это поле enum вместо текста). Переводили в двух местах и
// по-разному: в party-data только CHARTER и POA, в presentation-content не
// переводили вовсе — и в шапку договора уезжало «на основании CERTIFICATE».
import { describe, it, expect } from 'vitest'
import { signatoryBasisText } from '../src/lib/signatory-basis'

describe('signatoryBasisText', () => {
  it('переводит все служебные коды, а не только два', () => {
    expect(signatoryBasisText('CHARTER')).toBe('Устава')
    expect(signatoryBasisText('POA')).toBe('Доверенности')
    expect(signatoryBasisText('CERTIFICATE')).toBe('Свидетельства о государственной регистрации')
    expect(signatoryBasisText('REGULATION')).toBe('Положения')
  })

  it('OTHER даёт пусто: «на основании иного документа» в договоре выглядит нелепо', () => {
    expect(signatoryBasisText('OTHER')).toBeNull()
  })

  it('свободный текст человека не трогает', () => {
    expect(signatoryBasisText('Свидетельства о регистрации')).toBe('Свидетельства о регистрации')
    expect(signatoryBasisText('Доверенности № 5 от 01.02.2026')).toBe('Доверенности № 5 от 01.02.2026')
  })

  it('не зависит от регистра и пробелов вокруг кода', () => {
    expect(signatoryBasisText(' certificate ')).toBe('Свидетельства о государственной регистрации')
  })

  it('пустое значение остаётся пустым', () => {
    for (const v of [null, undefined, '']) expect(signatoryBasisText(v)).toBeNull()
  })

  it('ни один код не просачивается в текст договора', () => {
    for (const code of ['CHARTER', 'POA', 'CERTIFICATE', 'REGULATION', 'OTHER']) {
      expect(signatoryBasisText(code)).not.toBe(code)
    }
  })
})
