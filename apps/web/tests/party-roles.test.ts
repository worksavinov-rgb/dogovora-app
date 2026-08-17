// Юнит-тесты roleFromAiSettings — определение роли пользователя (Заказчик/Исполнитель)
// из настроек версии. Роль должна определяться ОДИНАКОВО в предпросмотре и выгрузке —
// это защитные тесты после бага, когда стороны в шапке и реквизитах вставали местами.
import { describe, it, expect, vi } from 'vitest'

// party-roles.ts импортирует prisma (для resolvePartyRole) — в юнит-тестах БД не нужна,
// подменяем модуль, чтобы не создавать реальный PrismaClient.
vi.mock('@/lib/db', () => ({ prisma: {} }))

import { roleFromAiSettings } from '@/lib/party-roles'

describe('roleFromAiSettings', () => {
  it('пустой объект настроек → null (роль не определена)', () => {
    expect(roleFromAiSettings({})).toBeNull()
  })

  it('null → null', () => {
    expect(roleFromAiSettings(null)).toBeNull()
  })

  it('не-объект (строка) → null', () => {
    expect(roleFromAiSettings('executor')).toBeNull()
  })

  it("userRole: 'executor' → 'EXECUTOR'", () => {
    expect(roleFromAiSettings({ userRole: 'executor' })).toBe('EXECUTOR')
  })

  it("userRole: 'customer' → 'CUSTOMER'", () => {
    expect(roleFromAiSettings({ userRole: 'customer' })).toBe('CUSTOMER')
  })

  it("userRole в верхнем регистре ('EXECUTOR') тоже распознаётся", () => {
    expect(roleFromAiSettings({ userRole: 'EXECUTOR' })).toBe('EXECUTOR')
  })

  it('пустая строка userRole → null (не падаем в дефолт молча)', () => {
    expect(roleFromAiSettings({ userRole: '' })).toBeNull()
  })

  it('customInstruction «Пользователь является исполнителем» → EXECUTOR', () => {
    expect(roleFromAiSettings({ customInstruction: 'Пользователь является исполнителем' })).toBe('EXECUTOR')
  })

  it('customInstruction «Пользователь — Заказчик» → CUSTOMER', () => {
    expect(roleFromAiSettings({ customInstruction: 'Пользователь — Заказчик' })).toBe('CUSTOMER')
  })

  it('userRole имеет приоритет над customInstruction', () => {
    expect(
      roleFromAiSettings({ userRole: 'customer', customInstruction: 'Пользователь является исполнителем' }),
    ).toBe('CUSTOMER')
  })

  it('неизвестный userRole и инструкция без упоминания ролей → null', () => {
    expect(roleFromAiSettings({ userRole: 'seller', customInstruction: 'Сделай построже' })).toBeNull()
  })
})
