// Пересчёт нумерации пунктов после блочной правки.
// Сценарий владельца: ИИ вставил новый пункт «1.3», а следующий тоже остался
// «1.3» — в разделе оказалось два одинаковых номера.
import { describe, it, expect } from 'vitest'
import { renumberClauseBlocks, renumberCrossReferences } from '@/lib/renumber-clauses'

describe('renumberClauseBlocks', () => {
  it('устраняет дубль после вставки пункта в середину раздела', () => {
    const blocks = [
      '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
      '<p>1.1. Исполнитель обязуется оказывать услуги.</p>',
      '<p>1.2. Конкретный перечень определяется Спецификациями.</p>',
      '<p><strong>1.3. Новый пункт, вставленный Догодком.</strong></p>',
      '<p>1.3. Настоящий Договор носит рамочный характер.</p>',
    ]
    const { blocks: out, renamed } = renumberClauseBlocks(blocks)

    expect(out[3]).toContain('1.3.')
    expect(out[4]).toContain('1.4.')
    expect(renamed.get('1.3')).toBe('1.4')
  })

  it('нумерует подпункты заново в каждом разделе', () => {
    const blocks = [
      '<h2>1. ПРЕДМЕТ</h2>',
      '<p>1.1. Первый.</p>',
      '<p>1.5. Второй с неверным номером.</p>',
      '<h2>2. ОБЯЗАТЕЛЬСТВА СТОРОН</h2>',
      '<p>2.4. Первый пункт второго раздела.</p>',
      '<p>2.5. Второй пункт.</p>',
    ]
    const { blocks: out } = renumberClauseBlocks(blocks)

    expect(out[1]).toContain('1.1.')
    expect(out[2]).toContain('1.2.')
    expect(out[4]).toContain('2.1.')
    expect(out[5]).toContain('2.2.')
  })

  it('нумерует третий уровень внутри своего подпункта', () => {
    const blocks = [
      '<h2>3. ПОРЯДОК РАСЧЁТОВ</h2>',
      '<p>3.1. Оплата производится так:</p>',
      '<p>3.1.5. Аванс.</p>',
      '<p>3.1.9. Окончательный расчёт.</p>',
      '<p>3.2. Иные условия.</p>',
    ]
    const { blocks: out } = renumberClauseBlocks(blocks)

    expect(out[2]).toContain('3.1.1.')
    expect(out[3]).toContain('3.1.2.')
    expect(out[4]).toContain('3.2.')
  })

  it('не трогает заголовки, преамбулу и корректную нумерацию', () => {
    const blocks = [
      '<p>г. Москва, «___» ______ 202__ г.</p>',
      '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
      '<p>1.1. Условие.</p>',
      '<p>1.2. Ещё условие.</p>',
    ]
    const { blocks: out, renamed } = renumberClauseBlocks(blocks)

    expect(out).toEqual(blocks)
    expect(renamed.size).toBe(0)
  })

  it('не ломает суммы и таблицы', () => {
    const blocks = [
      '<h2>4. ЦЕНА</h2>',
      '<p>4.1. Стоимость услуг составляет 350 200 (триста пятьдесят тысяч двести) рублей.</p>',
      '<table><tr><td>1</td><td>Монитор LG27</td><td>1,00</td><td>700</td></tr></table>',
    ]
    const { blocks: out } = renumberClauseBlocks(blocks)

    expect(out[1]).toContain('350 200')
    expect(out[2]).toBe(blocks[2])
  })
})

describe('renumberCrossReferences', () => {
  it('переписывает ссылки на сдвинувшиеся пункты', () => {
    const renamed = new Map([['1.3', '1.4']])
    const html = '<p>В соответствии с п. 1.3 настоящего Договора Стороны…</p>'
    expect(renumberCrossReferences(html, renamed)).toContain('п. 1.4')
  })

  it('понимает разные формы указателя', () => {
    const renamed = new Map([['2.1', '2.2']])
    expect(renumberCrossReferences('<p>согласно пункту 2.1</p>', renamed)).toContain('пункту 2.2')
    expect(renumberCrossReferences('<p>в пп. 2.1</p>', renamed)).toContain('пп. 2.2')
  })

  it('не трогает числа без указателя на пункт', () => {
    const renamed = new Map([['1.3', '1.4']])
    const html = '<p>Коэффициент 1.3 применяется к стоимости.</p>'
    expect(renumberCrossReferences(html, renamed)).toBe(html)
  })

  it('применяет замены одновременно, а не по цепочке', () => {
    // 1.3→1.4 и 1.4→1.5: без одновременного применения пункт 1.3 стал бы 1.5
    const renamed = new Map([['1.3', '1.4'], ['1.4', '1.5']])
    const out = renumberCrossReferences('<p>п. 1.3 и п. 1.4</p>', renamed)
    expect(out).toBe('<p>п. 1.4 и п. 1.5</p>')
  })
})
