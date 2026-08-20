import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ prisma: {} }))
import { buildRequisitesHtml } from '@/lib/html-document'
import type { CounterpartyData, UserProfileData } from '@/lib/ai/types'

const PROFILE: UserProfileData = {
  type: 'COMPANY', name: 'ООО «Догодок»', inn: '7714415571', kpp: '771401001', ogrn: '1157746000000',
} as UserProfileData

describe('buildRequisitesHtml — физлицо/самозанятый', () => {
  it('физлицо: паспорт есть, КПП/ОГРН нет', () => {
    const cp: CounterpartyData = {
      type: 'INDIVIDUAL', name: 'Иванов Иван Иванович',
      inn: '500100732259', passportSeries: '1234', passportNumber: '567890',
      passportIssuedBy: 'ОВД', passportIssueDate: '10.05.2015', passportDeptCode: '770-053',
      legalAddress: 'г. Москва',
    } as CounterpartyData
    const html = buildRequisitesHtml(PROFILE, cp, 'Заказчик', 'Исполнитель')
    expect(html).toContain('Паспорт: 1234 № 567890')
    expect(html).toContain('ИНН: 500100732259')
    // Проверяем именно колонку контрагента (профиль — юрлицо, у него КПП/ОГРН есть).
    const cpColumn = html.slice(html.indexOf('Исполнитель'))
    expect(cpColumn).not.toContain('КПП')
    expect(cpColumn).not.toContain('ОГРН')
  })

  it('самозанятый: строка про НПД', () => {
    const cp: CounterpartyData = {
      type: 'SELF_EMPLOYED', name: 'Петров Пётр', inn: '500100732259',
    } as CounterpartyData
    const html = buildRequisitesHtml(PROFILE, cp, 'Заказчик', 'Исполнитель')
    expect(html).toMatch(/налог на профессиональный доход/i)
  })
})
