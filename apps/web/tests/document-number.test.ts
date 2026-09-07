import { describe, it, expect } from 'vitest'
import {
  normalizeFormat,
  validateFormat,
  formatScope,
  renderNumber,
  buildMatcher,
  nextNumber,
  periodFromDateString,
} from '../src/lib/document-number'

// Локальная дата без сдвига часового пояса — как её строит сам модуль.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)

const MONTHLY = '{NNN}/{ММ}-{ГГ}'

describe('nextNumber — счётчик и его сброс', () => {
  const docs = ['005/08-26', '003/08-26', '001/08-26', '012/07-26']

  it('берёт максимум за период и увеличивает, а не считает количество', () => {
    // Именно максимум: если в списке пропуски (нет 002 и 004), «количество + 1»
    // выдало бы уже занятый номер.
    expect(nextNumber(MONTHLY, docs, at(2026, 8, 20))).toBe('006/08-26')
  })

  it('сбрасывает счёт на границе месяца', () => {
    expect(nextNumber(MONTHLY, docs, at(2026, 9, 1))).toBe('001/09-26')
  })

  it('сбрасывает счёт на границе года', () => {
    const december = ['007/12-26']
    expect(nextNumber(MONTHLY, december, at(2027, 1, 1))).toBe('001/01-27')
  })

  it('годовой шаблон не сбрасывается при смене месяца', () => {
    const yearly = '{NNN}/{ГГГГ}'
    expect(nextNumber(yearly, ['004/2026'], at(2026, 12, 31))).toBe('005/2026')
    expect(nextNumber(yearly, ['004/2026'], at(2027, 1, 1))).toBe('001/2027')
  })

  it('сквозной шаблон не сбрасывается никогда', () => {
    expect(nextNumber('Д-{N}', ['Д-9', 'Д-10'], at(2026, 8, 20))).toBe('Д-11')
    expect(nextNumber('Д-{N}', ['Д-9', 'Д-10'], at(2030, 1, 1))).toBe('Д-11')
  })

  it('начинает с единицы, когда документов ещё нет', () => {
    expect(nextNumber(MONTHLY, [], at(2026, 8, 20))).toBe('001/08-26')
  })

  it('пропускает пустые значения и номера чужого формата', () => {
    const messy = [null, undefined, '', '   ', 'без номера', 'Б/Н', '007/08-26']
    expect(nextNumber(MONTHLY, messy, at(2026, 8, 20))).toBe('008/08-26')
  })

  it('не обрезает счётчик, переросший ширину шаблона', () => {
    // 999 при ширине 2 — падать или обрезать до «00» нельзя, номер должен расти.
    expect(nextNumber('{NN}/{ГГ}', ['999/26'], at(2026, 8, 20))).toBe('1000/26')
  })

  it('разбирает счётчик, стоящий вплотную к году', () => {
    // Жадность \d+ не должна съесть цифры года.
    expect(nextNumber('{NNN}{ГГГГ}', ['0052026'], at(2026, 8, 20))).toBe('0062026')
  })
})

describe('periodFromDateString — разбор даты без сдвига часового пояса', () => {
  it('первое число месяца остаётся первым числом ЭТОГО месяца', () => {
    // new Date('2026-08-01') — это UTC-полночь, и в отрицательных смещениях
    // она превращается в 31 июля, то есть в номер за ПРОШЛЫЙ месяц.
    const d = periodFromDateString('2026-08-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(1)
  })

  it('первое января не уезжает в прошлый год', () => {
    const d = periodFromDateString('2026-01-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
  })

  it('номер за первое число строится за нужный месяц', () => {
    expect(renderNumber(MONTHLY, 1, periodFromDateString('2026-08-01'))).toBe('001/08-26')
  })

  it('на пустом значении берёт сегодняшний день, а не падает', () => {
    for (const empty of [null, undefined, '']) {
      expect(periodFromDateString(empty)).toBeInstanceOf(Date)
    }
  })
})

describe('normalizeFormat — латиница и кириллица', () => {
  it('принимает латинские плейсхолдеры: на глаз «М» и «M» неразличимы', () => {
    expect(normalizeFormat('{NNN}/{MM}-{YY}')).toBe('{NNN}/{ММ}-{ГГ}')
    expect(normalizeFormat('{NNN}/{YYYY}')).toBe('{NNN}/{ГГГГ}')
  })

  it('принимает кириллическую «Н» в счётчике', () => {
    expect(normalizeFormat('{ННН}/{ММ}')).toBe('{NNN}/{ММ}')
  })

  it('поднимает регистр плейсхолдеров', () => {
    expect(normalizeFormat('{nnn}/{мм}-{гг}')).toBe('{NNN}/{ММ}-{ГГ}')
  })

  it('не трогает текст вне фигурных скобок', () => {
    expect(normalizeFormat('ДГ-{N}/mm')).toBe('ДГ-{N}/mm')
  })
})

describe('validateFormat — что считаем ошибкой', () => {
  it('принимает рабочие шаблоны', () => {
    for (const tpl of [MONTHLY, '{N}', 'Д-{NN}/{ГГГГ}', '{NNN}']) {
      expect(validateFormat(tpl)).toBeNull()
    }
  })

  it('отвергает пустой шаблон', () => {
    expect(validateFormat('')?.code).toBe('EMPTY')
    expect(validateFormat('   ')?.code).toBe('EMPTY')
  })

  it('отвергает шаблон без счётчика — иначе все номера были бы одинаковыми', () => {
    expect(validateFormat('{ММ}-{ГГ}')?.code).toBe('NO_COUNTER')
    expect(validateFormat('просто текст')?.code).toBe('NO_COUNTER')
  })

  it('отвергает два счётчика — непонятно, какой из них увеличивать', () => {
    expect(validateFormat('{N}-{NN}')?.code).toBe('MANY_COUNTERS')
  })

  it('отвергает неизвестный плейсхолдер и называет его', () => {
    // Пропустить его «как есть» значило бы отдать пользователю договор
    // с номером «{ГОД}/08» — и заметил бы он это уже в Word.
    const err = validateFormat('{ГОД}/{N}')
    expect(err?.code).toBe('UNKNOWN_TOKEN')
    expect(err?.token).toBe('{ГОД}')
  })
})

describe('formatScope — область сброса выводится из шаблона', () => {
  it('месяц в шаблоне — сброс ежемесячный', () => {
    expect(formatScope(MONTHLY)).toBe('month')
  })

  it('только год — сброс ежегодный', () => {
    expect(formatScope('{NNN}/{ГГГГ}')).toBe('year')
    expect(formatScope('{NNN}/{ГГ}')).toBe('year')
  })

  it('ни года, ни месяца — сквозная нумерация', () => {
    expect(formatScope('Д-{N}')).toBe('global')
  })
})

describe('renderNumber и buildMatcher', () => {
  it('дополняет счётчик нулями до ширины шаблона', () => {
    expect(renderNumber('{NNN}', 5, at(2026, 8, 1))).toBe('005')
    expect(renderNumber('{N}', 5, at(2026, 8, 1))).toBe('5')
  })

  it('дополняет нулём однозначный месяц', () => {
    expect(renderNumber(MONTHLY, 1, at(2026, 1, 5))).toBe('001/01-26')
  })

  it('узнаёт свой период и не узнаёт соседний', () => {
    const re = buildMatcher(MONTHLY, at(2026, 8, 20))
    expect(re.test('006/08-26')).toBe(true)
    expect(re.test('006/07-26')).toBe(false)
    expect(re.test('006/08-25')).toBe(false)
    expect(re.test('ДГ-006/08-26')).toBe(false)
  })

  it('не хранит состояние между вызовами', () => {
    // С флагом g объект RegExp помнит lastIndex и в цикле давал бы пропуски.
    const re = buildMatcher(MONTHLY, at(2026, 8, 20))
    expect(re.test('001/08-26')).toBe(true)
    expect(re.test('001/08-26')).toBe(true)
  })
})
