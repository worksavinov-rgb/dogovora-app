// Отбор блоков для промпта и сопоставление их номеров с документом.
//
// Жалоба владельца: попросил переписать пункты 1.1–1.3 и добавить 1.4 и 1.5, а
// правки ушли в середину договора. Причина — карта соответствия «номер блока в
// промпте → блок в документе» восстанавливалась поиском по СОДЕРЖИМОМУ, и на
// документе с повторяющимися блоками съезжала.
import { describe, it, expect } from 'vitest'
import { selectBlocksForPrompt, applyBlockOps } from '@/lib/doc-blocks'

/**
 * Договор из n абзацев; часть из них намеренно одинаковые.
 * Блок с индексом `uniqueAt` содержит слово «конфиденциальность» — по нему и
 * ищем (форма слова совпадает с инструкцией: отбор идёт по точному вхождению),
 * остальные блоки этого слова не содержат.
 */
function bigDoc(n: number, dupEvery = 0, uniqueAt = 137): string[] {
  return Array.from({ length: n }, (_, i) => {
    if (i === uniqueAt) {
      return `<p>${i}. Стороны обязуются соблюдать конфиденциальность полученных сведений.</p>`
    }
    if (dupEvery && i % dupEvery === 0) {
      return '<p>Стороны подтверждают согласие с условиями.</p>' // повторяющийся блок
    }
    return `<p>${i}. Пункт договора под порядковым знаком ${i} с достаточно длинным текстом, чтобы документ вышел за лимит промпта и включился отбор блоков.</p>`
  })
}

describe('selectBlocksForPrompt', () => {
  it('короткий документ отдаёт целиком, без карты индексов', () => {
    const blocks = bigDoc(5)
    const res = selectBlocksForPrompt(blocks, 'усилить конфиденциальность', 100_000)
    expect(res.blocks).toEqual(blocks)
    expect(res.indexMap).toBeNull()
  })

  it('карта индексов соответствует выбранным блокам', () => {
    const blocks = bigDoc(200)
    const res = selectBlocksForPrompt(blocks, 'усилить конфиденциальность', 3000)

    expect(res.indexMap).not.toBeNull()
    expect(res.blocks).toHaveLength(res.indexMap!.length)
    // Каждый блок стоит ровно на том месте, на которое указывает карта
    res.indexMap!.forEach((origIdx, i) => {
      expect(res.blocks[i]).toBe(blocks[origIdx])
    })
  })

  it('повторяющиеся блоки не ломают карту индексов', () => {
    // Раньше именно здесь всё и рушилось: одинаковые блоки попадали в карту
    // лишний раз, и номера съезжали.
    const blocks = bigDoc(200, 4)
    const res = selectBlocksForPrompt(blocks, 'усилить конфиденциальность', 3000)

    expect(res.blocks).toHaveLength(res.indexMap!.length)
    res.indexMap!.forEach((origIdx, i) => {
      expect(res.blocks[i]).toBe(blocks[origIdx])
    })
    // Индексы строго возрастают и не повторяются
    const sorted = [...res.indexMap!].sort((a, b) => a - b)
    expect(res.indexMap).toEqual(sorted)
    expect(new Set(res.indexMap).size).toBe(res.indexMap!.length)
  })

  it('правка через карту индексов попадает в нужный пункт', () => {
    const blocks = bigDoc(200, 4)
    const res = selectBlocksForPrompt(blocks, 'усилить конфиденциальность', 3000)
    const targetInPrompt = res.blocks.findIndex((b) => b.includes('конфиденциальность'))
    expect(targetInPrompt).toBeGreaterThanOrEqual(0)

    // Модель адресует блок по номеру в промпте (1-based) — переводим в индекс документа
    const docIndex = res.indexMap![targetInPrompt]!
    const applied = applyBlockOps(blocks, [
      { type: 'replace', from: docIndex + 1, to: docIndex + 1, html: '<p>ЗАМЕНЁННЫЙ ПУНКТ</p>' },
    ])

    expect(applied.applied).toBe(1)
    // Заменился именно тот пункт, а не соседний «в середине документа»
    expect(applied.html).toContain('ЗАМЕНЁННЫЙ ПУНКТ')
    expect(applied.html).not.toContain('обязуются соблюдать конфиденциальность')
    expect(applied.html).toContain('порядковым знаком 138')
  })

  it('когда совпадений нет — берёт начало документа по лимиту', () => {
    const blocks = bigDoc(200)
    const res = selectBlocksForPrompt(blocks, 'zzzz', 3000)

    expect(res.indexMap).not.toBeNull()
    expect(res.indexMap![0]).toBe(0)
    // Идут подряд с самого начала
    res.indexMap!.forEach((v, i) => expect(v).toBe(i))
    expect(res.blocks[0]).toBe(blocks[0])
  })
})
