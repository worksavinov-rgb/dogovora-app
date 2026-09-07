/**
 * Разбор карточки реквизитов контрагента (Word / PDF / текст) — БЕЗ ИИ.
 *
 * Почему без ИИ: реквизиты — не свободный текст, а строгие форматы с контрольными
 * суммами. Проверка либо сходится, либо нет; выдумать несуществующий ИНН такой
 * разбор физически не может, а модель — может. Плюс данные не покидают наш сервер,
 * значит не нужно согласие по 152-ФЗ. Спека:
 * docs/superpowers/specs/2026-09-07-counterparty-requisites-parsing-design.md
 *
 * Модуль чистый: ни БД, ни HTTP, ни React — только текст на входе и поля на выходе.
 */

import {
  validateInn,
  validateOgrn,
  validateBik,
  validateCheckingAccount,
  validateCorrespondentAccount,
  validateKpp,
} from './validation'

export type PartyType =
  | 'INDIVIDUAL'
  | 'SELF_EMPLOYED'
  | 'SOLE_PROPRIETOR'
  | 'COMPANY'
  | 'ANO'
  | 'PAO'
  | 'ZAO'

export interface ParsedRequisites {
  type: PartyType | null
  name: string | null
  inn: string | null
  kpp: string | null
  ogrn: string | null
  legalAddress: string | null
  actualAddress: string | null
  email: string | null
  phone: string | null
  bankName: string | null
  checkingAccount: string | null
  bik: string | null
  correspondentAccount: string | null
  passportSeries: string | null
  passportNumber: string | null
  passportIssuedBy: string | null
  passportIssueDate: string | null
  passportDeptCode: string | null
  signatoryName: string | null
  signatoryPosition: string | null
  signatoryBasis: string | null
  /** Сколько полей удалось распознать — для полосы «Распознано N полей» */
  foundCount: number
}

/** Типы, у которых не бывает КПП и ОГРН юрлица, а ИНН — 12-значный */
const PERSONAL_TYPES: PartyType[] = ['INDIVIDUAL', 'SELF_EMPLOYED', 'SOLE_PROPRIETOR']

const EMPTY: ParsedRequisites = {
  type: null, name: null, inn: null, kpp: null, ogrn: null,
  legalAddress: null, actualAddress: null, email: null, phone: null,
  bankName: null, checkingAccount: null, bik: null, correspondentAccount: null,
  passportSeries: null, passportNumber: null, passportIssuedBy: null,
  passportIssueDate: null, passportDeptCode: null,
  signatoryName: null, signatoryPosition: null, signatoryBasis: null,
  foundCount: 0,
}

// ─── Подготовка текста ────────────────────────────────────────────────────────

/** Неразрывные пробелы, разные тире и хвостовые пробелы приводим к обычным. */
function normalize(raw: string): { text: string; lines: string[] } {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[    ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
  return { text, lines: text.split('\n') }
}

// ─── Числа ────────────────────────────────────────────────────────────────────

interface NumCandidate { value: string; index: number }

/**
 * Кандидаты в реквизиты — ТОЛЬКО целые цепочки цифр, без скользящего окна.
 * Скользящее окно вырезало бы настоящий ИНН из идентификатора ЭДО
 * «2PS-33060403295800000000000089731101» и подставило чужое число в договор.
 *
 * Вторым проходом склеиваем цепочки, разорванные пробелами: PDF нередко печатает
 * счёт как «40802 810 2 0000 0151784». Склейка безопасна — всё равно всё
 * проверяется контрольной суммой, а склеенный мусор её не проходит.
 */
function numberCandidates(text: string): NumCandidate[] {
  const seen = new Set<string>()
  const out: NumCandidate[] = []
  const push = (value: string, index: number) => {
    const key = `${index}:${value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ value, index })
  }
  for (const m of text.matchAll(/\d+/g)) push(m[0], m.index)
  for (const m of text.matchAll(/\d[\d ]*\d/g)) push(m[0].replace(/ /g, ''), m.index)
  return out
}

/** Ближайшее к якорю значение из списка кандидатов. */
function nearest(cands: NumCandidate[], anchor: number): NumCandidate | null {
  if (!cands.length) return null
  return cands.reduce((best, c) =>
    Math.abs(c.index - anchor) < Math.abs(best.index - anchor) ? c : best)
}

// ─── Ярлыки ───────────────────────────────────────────────────────────────────

/**
 * Строки, на которых сбор значения обрывается. Без этого юридический адрес
 * «съел» бы следующие за ним телефон и почту: PDF рвёт длинный адрес на строки,
 * и понять, где он кончился, можно только по началу следующего ярлыка.
 */
const STOP_LABEL = new RegExp(
  '^\\s*(' + [
    'инн', 'кпп', 'огрн(ип)?', 'бик', 'р/?с', 'к/?с',
    'расч[её]тн[а-яё]*', 'коррес[а-яё]*', 'сч[её]т[а-яё]*',
    'наименование\\s+банка', 'банк[а-яё]*', 'реквизиты',
    'юридическ[а-яё]+\\s+адрес', 'фактическ[а-яё]+\\s+адрес', 'почтов[а-яё]+\\s+адрес',
    'адрес\\s+регистрации', 'место\\s+нахождения', 'адрес',
    'контактн[а-яё]+', 'моб[а-яё]*\\.?\\s*тел[а-яё]*\\.?', 'тел[а-яё]*\\.?', 'телефон',
    'e-?mail', 'почта', 'сайт', 'окпо', 'окв[еэ]д', 'окато', 'октмо',
    'система\\s+налогообложения', 'эдо', 'дата\\s+регистрации', 'паспорт',
    'генеральн[а-яё]+\\s+директор[а-яё]*', 'директор[а-яё]*', 'подпис[а-яё]+',
    'руководител[а-яё]+',
  ].join('|') + ')(?![а-яёa-z])[\\s:.—-]*',
  'i',
)

/**
 * Значение ярлыка: остаток той же строки, а если он пуст — следующие строки
 * до ближайшего ярлыка или пустой строки. maxLines ограничивает жадность.
 */
function labelValue(lines: string[], label: RegExp, maxLines = 3): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const m = line.match(label)
    if (!m) continue

    const parts: string[] = []
    const tail = line.slice(m.index! + m[0].length).replace(/^[\s:.—-]+/, '').trim()
    if (tail) parts.push(tail)

    for (let j = i + 1; j < lines.length && parts.length < maxLines; j++) {
      const next = lines[j]!
      if (!next || STOP_LABEL.test(next)) break
      parts.push(next)
    }

    const value = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (value) return value
  }
  return null
}

/** Позиция первого совпадения регулярки, или -1. */
function offsetOf(text: string, re: RegExp): number {
  const m = text.match(re)
  return m?.index ?? -1
}

// ─── Имя стороны ──────────────────────────────────────────────────────────────

const ORG_NAME_RE = /((?:ООО|ОАО|ЗАО|ПАО|АО|АНО|НКО|НАО)\s*[«"'][^»"'\n]{2,140}[»"'])/i
const ORG_LONG_RE = /(Общество\s+с\s+ограниченной\s+ответственностью\s*[«"'][^»"'\n]{2,140}[»"'])/i
const FIO_RE = /^[А-ЯЁ][А-ЯЁа-яё-]+\s+[А-ЯЁ][А-ЯЁа-яё-]+\s+[А-ЯЁ][А-ЯЁа-яё-]+$/

/** «МАРКИН МИХАИЛ МИХАЙЛОВИЧ» → «Маркин Михаил Михайлович». Смешанный регистр не трогаем. */
function fixCaps(s: string): string {
  if (s !== s.toUpperCase()) return s
  return s
    .toLowerCase()
    .replace(/(^|[\s-])([а-яёa-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

// ─── Главная функция ──────────────────────────────────────────────────────────

export function parseRequisites(raw: string): ParsedRequisites {
  if (!raw || !raw.trim()) return { ...EMPTY }

  const { text, lines } = normalize(raw)
  const cands = numberCandidates(text)
  const r: ParsedRequisites = { ...EMPTY }

  // 1. Банк опознаём первым: он даёт якорь, по которому потом отсекаются
  //    банковские ИНН и КПП, и БИК для контрольных сумм счетов.
  r.bankName = labelValue(lines, /наименование\s+банка|^банк(?![а-яё])/i, 1)
  const bik = cands.find((c) => c.value.length === 9 && validateBik(c.value) === null)
  r.bik = bik?.value ?? null

  const bankAnchor = [
    offsetOf(text, /БИК/i),
    offsetOf(text, /коррес/i),
    offsetOf(text, /наименование\s+банка/i),
    offsetOf(text, /(?:^|[^а-яё])банк/i),
  ].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? Number.MAX_SAFE_INTEGER

  // 2. ОГРН / ОГРНИП — он же якорь стороны и главный признак типа.
  const ogrnCands = cands.filter((c) =>
    (c.value.length === 13 && validateOgrn(c.value, 'company') === null) ||
    (c.value.length === 15 && validateOgrn(c.value, 'ip') === null))
  const ogrn = ogrnCands[0] ?? null
  r.ogrn = ogrn?.value ?? null
  const partyAnchor = ogrn?.index ?? 0

  // 3. ИНН-кандидаты. В карточке их обычно ДВА — стороны и её банка, оба настоящие
  //    и оба проходят контрольную сумму.
  const innCands = cands.filter((c) =>
    (c.value.length === 10 || c.value.length === 12) && validateInn(c.value) === null)

  // 4. Тип стороны — до выбора «нашего» ИНН и КПП: он решает, какие из них наши.
  r.type = detectType(
    text,
    r.ogrn,
    innCands.some((c) => c.value.length === 12),
    innCands.some((c) => c.value.length === 10),
  )
  const isPersonal = r.type !== null && PERSONAL_TYPES.includes(r.type)

  //    У ИП и физлица ИНН всегда 12-значный, поэтому 10-значный в такой карточке
  //    заведомо банковский. У организации оба 10-значные — разводим по близости к якорю.
  r.inn = pickOwn(innCands, isPersonal ? 12 : 10, partyAnchor, bankAnchor, isPersonal)

  // 5. КПП. У ИП, физлица и самозанятого его не бывает вовсе — найденный в такой
  //    карточке КПП принадлежит банку, и подставить его значило бы соврать в договоре.
  if (!isPersonal) {
    const kppCands = cands.filter((c) => c.value.length === 9 && validateKpp(c.value) === null
      && c.value !== r.bik)
    r.kpp = pickOwn(kppCands, 9, partyAnchor, bankAnchor, false)
  }

  // 6. Счета. Расчётный и корреспондентский считаются по РАЗНЫМ формулам —
  //    это и разводит их надёжнее любых ярлыков.
  for (const c of cands) {
    if (c.value.length !== 20) continue
    if (c.value.startsWith('301')) {
      if (!r.correspondentAccount && validateCorrespondentAccount(c.value, r.bik ?? '') === null) {
        r.correspondentAccount = c.value
      }
    } else if (!r.checkingAccount && validateCheckingAccount(c.value, r.bik ?? '') === null) {
      r.checkingAccount = c.value
    }
  }

  // 7. Текстовые поля по ярлыкам.
  r.legalAddress = labelValue(lines, /юридическ[а-яё]+\s+адрес|адрес\s+регистрации|место\s+нахождения/i, 4)
  r.actualAddress = labelValue(lines, /фактическ[а-яё]+\s+адрес|почтов[а-яё]+\s+адрес/i, 4)
  r.email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null
  r.phone = text.match(/(?:\+7|\b8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}\b/)?.[0]?.trim() ?? null

  // 8. Наименование.
  r.name = detectName(text, lines, r.type, r.bankName)

  // 9. Паспорт — встречается в карточках физлиц.
  const passport = text.match(/паспорт\D{0,40}(\d{2}\s?\d{2})\s*(?:№|N|»)?\s*(\d{6})/i)
  if (passport) {
    r.passportSeries = passport[1]!.replace(/\s/g, '')
    r.passportNumber = passport[2]!
  }
  r.passportIssuedBy = labelValue(lines, /кем\s+выдан|выдан(?![а-яё])/i, 2)
  r.passportDeptCode = text.match(/код\s+подразделения\D{0,10}(\d{3}\s*-\s*\d{3})/i)?.[1]?.replace(/\s/g, '') ?? null

  // 10. Подписант. В карточках реквизитов его почти никогда нет — форма покажет
  //     подсказку, что добавить придётся вручную.
  r.signatoryName = text.match(/в\s+лице\s+([^,\n]{5,80})/i)?.[1]?.trim() ?? null
  r.signatoryBasis = text.match(/действующ[а-яё]*\s+на\s+основании\s+([^,\n.]{2,60})/i)?.[1]?.trim() ?? null
  r.signatoryPosition = text.match(
    /(генеральн[а-яё]+\s+директор[а-яё]*|исполнительн[а-яё]+\s+директор[а-яё]*|директор[а-яё]*|управляющ[а-яё]+|президент[а-яё]*|главн[а-яё]+\s+бухгалтер[а-яё]*)/i,
  )?.[1]?.trim() ?? null

  r.foundCount = countFound(r)
  return r
}

/**
 * Выбор «нашего» числа из кандидатов, среди которых могут быть банковские.
 * expectedLen — длина, обязательная для этого типа стороны.
 */
function pickOwn(
  cands: NumCandidate[],
  expectedLen: number,
  partyAnchor: number,
  bankAnchor: number,
  strictLength: boolean,
): string | null {
  const fit = cands.filter((c) => c.value.length === expectedLen)
  const pool = strictLength ? fit : (fit.length ? fit : cands)
  if (!pool.length) return null
  if (pool.length === 1) return pool[0]!.value

  // Несколько кандидатов — наш тот, что ближе к якорю стороны, чем к банковскому.
  const ours = pool.filter((c) =>
    Math.abs(c.index - partyAnchor) <= Math.abs(c.index - bankAnchor))
  return (nearest(ours.length ? ours : pool, partyAnchor))?.value ?? null
}

function detectType(
  text: string,
  ogrn: string | null,
  hasInn12: boolean,
  hasInn10: boolean,
): PartyType | null {
  // ОГРН — самый сильный признак, он старше любых слов в тексте: в карточке ООО
  // вполне может попасться слово «ИП» (например, в назначении платежа), и оно не
  // должно перебивать 13-значный ОГРН.
  if (ogrn?.length === 15) return 'SOLE_PROPRIETOR'
  if (ogrn?.length === 13) return orgSubtype(text)

  if (/самозанят|налог[а-яё]*\s+на\s+профессиональн[а-яё]+\s+доход|(?:^|[^а-яё])НПД(?![а-яё])/i.test(text)) {
    return 'SELF_EMPLOYED'
  }
  if (/индивидуальн[а-яё]+\s+предпринимател|(?:^|[^а-яёa-z])ИП(?![а-яёa-z])/i.test(text)) {
    return 'SOLE_PROPRIETOR'
  }
  if (hasInn12) return 'INDIVIDUAL'
  if (hasInn10) return orgSubtype(text)
  return null
}

function orgSubtype(text: string): PartyType {
  if (/(?:^|[^а-яё])ПАО(?![а-яё])|Публичн[а-яё]+\s+акционерн/i.test(text)) return 'PAO'
  if (/(?:^|[^а-яё])ЗАО(?![а-яё])|Закрыт[а-яё]+\s+акционерн/i.test(text)) return 'ZAO'
  if (/(?:^|[^а-яё])АНО(?![а-яё])|Автономн[а-яё]+\s+некоммерческ/i.test(text)) return 'ANO'
  return 'COMPANY'
}

function detectName(
  text: string,
  lines: string[],
  type: PartyType | null,
  bankName: string | null,
): string | null {
  const isPersonal = type !== null && PERSONAL_TYPES.includes(type)

  if (!isPersonal) {
    // Название организации в кавычках. Название банка исключаем: в карточке
    // «АО "Райффайзенбанк"» стоит рядом и легко занимает место контрагента.
    for (const re of [ORG_LONG_RE, ORG_NAME_RE]) {
      for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
        const found = m[1]!.trim()
        if (bankName && bankName.includes(found)) continue
        if (/банк|bank/i.test(found)) continue
        return found
      }
    }
  }

  // ФИО отдельной строкой — так печатают карточки ИП и физлиц.
  for (const line of lines) {
    if (!FIO_RE.test(line)) continue
    const fio = fixCaps(line)
    return type === 'SOLE_PROPRIETOR' ? `ИП ${fio}` : fio
  }

  return null
}

function countFound(r: ParsedRequisites): number {
  const fields: (keyof ParsedRequisites)[] = [
    'name', 'inn', 'kpp', 'ogrn', 'legalAddress', 'actualAddress', 'email', 'phone',
    'bankName', 'checkingAccount', 'bik', 'correspondentAccount',
    'passportSeries', 'passportNumber', 'passportIssuedBy', 'passportIssueDate',
    'passportDeptCode', 'signatoryName', 'signatoryPosition', 'signatoryBasis',
  ]
  return fields.filter((f) => r[f] !== null && r[f] !== '').length
}
