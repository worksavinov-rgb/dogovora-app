import { describe, it, expect } from 'vitest'
import { parseRequisites } from '../src/lib/requisites-parser'

// ВАЖНО: все реквизиты ниже ВЫМЫШЛЕННЫЕ, но подобраны так, чтобы честно проходить
// контрольные суммы — иначе тест проверял бы не то. Структура карточек скопирована
// с реальных выгрузок (банк, 1С), персональные данные живых людей в репозиторий не кладём.
//
// Данные банка (Райффайзенбанк: БИК, корр. счёт, ИНН, КПП) — публичные банковские
// реквизиты, а не ПДн. Они здесь нужны специально: в настоящей карточке они стоят
// рядом с реквизитами стороны, и главный риск разбора — перепутать их местами.

const CARD_IP = `Карточка индивидуального предпринимателя
ПЕТРОВ ПЁТР ПЕТРОВИЧ
ОГРНИП 326774000001238
Дата регистрации 04.02.2026
ИНН 771234567859
Основной ОКВЭД 82.30 • Деятельность по
организации конференций и
выставок
Реквизиты счета
Расчетный счет
40802810900000777015
Наименование банка
АО "Райффайзенбанк", г. Москва
Корреспондентский счет 30101810200000000700 - ОКЦ № 1 ГУ
Банка России по ЦФО
БИК
044525700
ИНН
7744000302
КПП
770401001
Контактные данные
Фактический адрес: 129344, г. Москва, ул. Енисейская, д. 3
кв. 53
Юридический адрес: 601785 – обл. Владимирская, р-н
Кольчугинский, г. Кольчугино, ул.
Добровольского, д. 17 кв. 14.
Моб. тел.: +7 903 555 14 17
e-mail: petrov@example.com
Система налогообложения УСН "доходы-расходы, 15%". НДС не
предусмотрен
ЭДО. Поток
ЭДО: 2PS-77123456785900000000000089731101`

const CARD_OOO = `КАРТОЧКА ПРЕДПРИЯТИЯ
Полное наименование: Общество с ограниченной ответственностью «Ромашка»
ИНН 7707123458
КПП 770701001
ОГРН 1027700000129
Юридический адрес: 117418, г. Москва, ул. Профсоюзная, д. 23
Фактический адрес: 117418, г. Москва, ул. Профсоюзная, д. 23, оф. 5
Генеральный директор Сидоров Сидор Сидорович, действующий на основании Устава
Банковские реквизиты
Наименование банка: АО "Райффайзенбанк", г. Москва
Расчетный счет 40702810900000777018
Корреспондентский счет 30101810200000000700
БИК 044525700
ИНН банка 7744000302
КПП банка 770401001
Телефон: +7 495 555-44-33
e-mail: info@romashka.example`

describe('parseRequisites — карточка ИП', () => {
  const r = parseRequisites(CARD_IP)

  it('определяет тип стороны по 15-значному ОГРНИП', () => {
    expect(r.type).toBe('SOLE_PROPRIETOR')
    expect(r.ogrn).toBe('326774000001238')
  })

  it('берёт ИНН предпринимателя, а не его банка', () => {
    expect(r.inn).toBe('771234567859')
    expect(r.inn).not.toBe('7744000302')
  })

  it('не подставляет КПП: у ИП его не бывает, найденный в файле — банковский', () => {
    expect(r.kpp).toBeNull()
  })

  it('приводит ФИО из верхнего регистра и добавляет «ИП»', () => {
    expect(r.name).toBe('ИП Петров Пётр Петрович')
  })

  it('разводит расчётный и корреспондентский счета по их разным формулам', () => {
    expect(r.checkingAccount).toBe('40802810900000777015')
    expect(r.correspondentAccount).toBe('30101810200000000700')
    expect(r.bik).toBe('044525700')
  })

  it('собирает адреса, разорванные PDF на несколько строк', () => {
    expect(r.legalAddress).toContain('Кольчугино')
    expect(r.legalAddress).toContain('Добровольского')
    // адрес не должен «съесть» следующий за ним телефон
    expect(r.legalAddress).not.toContain('555')
    expect(r.actualAddress).toContain('Енисейская')
  })

  it('берёт банк, телефон и почту', () => {
    expect(r.bankName).toContain('Райффайзенбанк')
    expect(r.phone).toBe('+7 903 555 14 17')
    expect(r.email).toBe('petrov@example.com')
  })
})

describe('parseRequisites — карточка ООО', () => {
  const r = parseRequisites(CARD_OOO)

  it('определяет организацию и берёт её ИНН и КПП, а не банковские', () => {
    expect(r.type).toBe('COMPANY')
    expect(r.inn).toBe('7707123458')
    expect(r.kpp).toBe('770701001')
    expect(r.ogrn).toBe('1027700000129')
  })

  it('берёт наименование организации, а не название банка', () => {
    expect(r.name).toContain('Ромашка')
    expect(r.name).not.toContain('Райффайзен')
  })

  it('находит подписанта и основание', () => {
    expect(r.signatoryPosition).toMatch(/директор/i)
    expect(r.signatoryBasis).toBe('Устава')
  })

  it('берёт счета организации', () => {
    expect(r.checkingAccount).toBe('40702810900000777018')
    expect(r.correspondentAccount).toBe('30101810200000000700')
  })
})

describe('parseRequisites — ловушки', () => {
  it('не принимает за реквизиты телефон, дату, ОКВЭД и идентификатор ЭДО', () => {
    const r = parseRequisites(CARD_IP)
    const values = [r.inn, r.kpp, r.ogrn, r.checkingAccount, r.correspondentAccount, r.bik]
    expect(values).not.toContain('79035551417')
    expect(values).not.toContain('04022026')
    expect(values).not.toContain('8230')
    // ИНН стоит ЦЕЛИКОМ внутри идентификатора ЭДО — вырезать его оттуда нельзя,
    // иначе в договор попадёт число, взятое неизвестно откуда
    expect(values).not.toContain('77123456785900000000000089731101')
  })

  it('оставляет поле пустым, если контрольная сумма не сошлась', () => {
    const broken = CARD_IP
      .replace('771234567859', '771234567858')
      .replace('326774000001238', '326774000001237')
    const r = parseRequisites(broken)
    expect(r.inn).toBeNull()
    expect(r.ogrn).toBeNull()
  })

  it('не принимает корр. счёт за расчётный и наоборот', () => {
    const r = parseRequisites(CARD_IP)
    expect(r.checkingAccount).not.toBe(r.correspondentAccount)
    expect(r.correspondentAccount!.startsWith('301')).toBe(true)
  })

  it('на пустом и мусорном тексте ничего не выдумывает', () => {
    for (const text of ['', '   \n\n  ', 'Привет! Это не карточка реквизитов.']) {
      const r = parseRequisites(text)
      expect(r.inn).toBeNull()
      expect(r.checkingAccount).toBeNull()
      expect(r.foundCount).toBe(0)
    }
  })
})

describe('parseRequisites — счётчик распознанного', () => {
  it('считает заполненные поля для полосы «Распознано N полей»', () => {
    expect(parseRequisites(CARD_IP).foundCount).toBeGreaterThanOrEqual(8)
    expect(parseRequisites(CARD_OOO).foundCount).toBeGreaterThanOrEqual(8)
  })
})
