import { describe, it, expect } from 'vitest'
import {
  validatePassportSeries,
  validatePassportNumber,
  validatePassportDeptCode,
} from '@/lib/validation'

describe('паспортные валидаторы — пустое значение допустимо (поля необязательны)', () => {
  it('пустая строка везде валидна', () => {
    expect(validatePassportSeries('')).toBeNull()
    expect(validatePassportNumber('')).toBeNull()
    expect(validatePassportDeptCode('')).toBeNull()
  })
})

describe('validatePassportSeries', () => {
  it('4 цифры — ок', () => expect(validatePassportSeries('1234')).toBeNull())
  it('не 4 цифры — ошибка', () => expect(validatePassportSeries('12')).toMatch(/4 цифры/))
  it('буквы — ошибка', () => expect(validatePassportSeries('12ab')).toMatch(/цифр/))
})

describe('validatePassportNumber', () => {
  it('6 цифр — ок', () => expect(validatePassportNumber('567890')).toBeNull())
  it('не 6 цифр — ошибка', () => expect(validatePassportNumber('5678')).toMatch(/6 цифр/))
})

describe('validatePassportDeptCode', () => {
  it('формат NNN-NNN — ок', () => expect(validatePassportDeptCode('770-053')).toBeNull())
  it('без дефиса — ошибка', () => expect(validatePassportDeptCode('770053')).toMatch(/подразделения/))
})
