// Отчёт о правке: что именно изменилось в документе.
// Жалоба владельца: попросил переписать пункты 1.1–1.3 и добавить 1.4 и 1.5 —
// ИИ ответил «Готово», хотя новых пунктов в документе не появилось. Список
// изменений должен считаться кодом, чтобы модель не могла заявить о правке,
// которой нет.
import { describe, it, expect } from 'vitest'
import { diffDocumentBlocks, summarizeChanges, buildEditReportPrompt } from '@/lib/edit-report'

const doc = (...paragraphs: string[]) => paragraphs.map((p) => `<p>${p}</p>`).join('')

describe('diffDocumentBlocks', () => {
  it('видит добавленные пункты', () => {
    const before = doc('1.1. Первый пункт.', '1.2. Второй пункт.')
    const after = doc('1.1. Первый пункт.', '1.2. Второй пункт.', '1.3. Новый пункт.')

    const changes = diffDocumentBlocks(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('added')
    expect(changes[0]!.after).toContain('Новый пункт')
  })

  it('видит переписанный пункт как изменение', () => {
    const before = doc('1.1. Исполнитель оказывает услуги.')
    const after = doc('1.1. Исполнитель обязуется оказать услуги в согласованный срок.')

    const changes = diffDocumentBlocks(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('changed')
    expect(changes[0]!.before).toContain('оказывает услуги')
    expect(changes[0]!.after).toContain('в согласованный срок')
  })

  it('видит удаление пункта', () => {
    const before = doc('1.1. Первый.', '1.2. Лишний пункт.', '1.3. Третий.')
    const after = doc('1.1. Первый.', '1.3. Третий.')

    const changes = diffDocumentBlocks(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('removed')
    expect(changes[0]!.before).toContain('Лишний пункт')
  })

  it('на неизменённом документе не находит правок', () => {
    const same = doc('1.1. Первый пункт.', '1.2. Второй пункт.')
    expect(diffDocumentBlocks(same, same)).toEqual([])
  })

  it('не считает правкой разницу в разметке и пробелах', () => {
    const before = doc('1.1. Первый пункт.')
    const after = '<p>  1.1.   Первый пункт.  </p>'
    expect(diffDocumentBlocks(before, after)).toEqual([])
  })
})

describe('summarizeChanges', () => {
  it('складывает сводку по видам изменений', () => {
    const summary = summarizeChanges([
      { kind: 'changed', before: 'а', after: 'б' },
      { kind: 'added', after: 'в' },
      { kind: 'added', after: 'г' },
    ])
    expect(summary).toContain('изменено пунктов: 1')
    expect(summary).toContain('добавлено: 2')
  })

  it('на пустом списке даёт пустую строку', () => {
    expect(summarizeChanges([])).toBe('')
  })
})

describe('buildEditReportPrompt', () => {
  it('передаёт модели задание клиента и фактические изменения', () => {
    const prompt = buildEditReportPrompt('Добавь пункты 1.4 и 1.5', [
      { kind: 'changed', before: 'старый текст', after: 'новый текст' },
    ])
    expect(prompt).toContain('Добавь пункты 1.4 и 1.5')
    expect(prompt).toContain('старый текст')
    expect(prompt).toContain('новый текст')
  })

  it('требует признаться в невыполненной части задания', () => {
    const prompt = buildEditReportPrompt('Добавь пункты', [])
    expect(prompt).toMatch(/НЕ выполнена|не сделано/i)
  })

  it('не раздувается на огромном списке изменений', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      kind: 'added' as const, after: `Пункт ${i}`,
    }))
    const prompt = buildEditReportPrompt('Перепиши договор', many)
    expect(prompt).toContain('и ещё изменений: 28')
  })
})
