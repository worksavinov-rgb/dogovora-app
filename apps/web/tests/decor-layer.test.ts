import { describe, it, expect } from 'vitest'
import { hasInlineRequisites, buildRequisitesHtml } from '../src/lib/html-document'
import type { UserProfileData, CounterpartyData } from '../src/lib/ai/types'

describe('hasInlineRequisites', () => {
  it('находит вклеенный системный блок реквизитов (legacy-версии)', () => {
    const reqs = buildRequisitesHtml(
      { name: 'ООО Ромашка', inn: '7700000000' } as UserProfileData,
      { name: 'ИП Иванов', inn: '770000000000' } as CounterpartyData,
      'Заказчик', 'Исполнитель',
    )
    expect(hasInlineRequisites(`<h2>1. Предмет договора</h2><p>Текст.</p>${reqs}`)).toBe(true)
  })

  it('находит блок с заголовком «РЕКВИЗИТЫ И ПОДПИСИ СТОРОН» абзацами', () => {
    const html = '<h2>1. Предмет</h2><p>Текст.</p><h2>РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2><p>ИНН: 7700000000</p>'
    expect(hasInlineRequisites(html)).toBe(true)
  })

  it('не срабатывает на теле без блока', () => {
    expect(hasInlineRequisites('<h2>1. Предмет</h2><p>Стороны согласовали порядок оплаты и сроки выполнения работ.</p>')).toBe(false)
  })

  it('не срабатывает на пустом контенте', () => {
    expect(hasInlineRequisites('')).toBe(false)
  })
})
