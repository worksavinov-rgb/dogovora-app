// Слой оформления: ручная правка старше автоматики.
//
// Два зеркальных бага, найденных на живом проде 07.09.2026:
//  1) ШАПКА сохранялась один раз и больше не пересобиралась. Проверено опытом:
//     прошёл «Оформление» → «ДОГОВОР № 17/03», поменял номер на 99/12-99 →
//     в шапке остался 17/03. Старый номер уехал бы в подписанный Word.
//  2) РЕКВИЗИТЫ, наоборот, пересобирались при каждом показе и молча затирали
//     ручную правку.
//
// Правило владельца: ручная правка в приоритете всегда. Отсюда флаги
// preambleManual/requisitesManual — блок без флага пересобирается всегда,
// блок с флагом не трогается никогда.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const СТАРАЯ_ШАПКА = '<p class="doc-preamble-title ta-center"><strong>ДОГОВОР № 17/03</strong></p>'
const РУЧНАЯ_ШАПКА = '<p class="doc-preamble-title ta-center"><strong>ДОГОВОР ОСОБОГО ВИДА № РУЧ-1</strong></p>'
const РУЧНЫЕ_РЕКВИЗИТЫ = '<div class="doc-requisites"><p>ОСОБЫЕ РЕКВИЗИТЫ, ВПИСАННЫЕ ЧЕЛОВЕКОМ</p></div>'

const docRow = {
  id: 'doc1',
  type: 'CONTRACT',
  number: '17/03',
  documentNumber: null,
  signingDate: null,
  decorCity: 'Ульяновск',
  decorSignatoryId: null as string | null,
  preambleHtml: null as string | null,
  requisitesHtml: null as string | null,
  preambleManual: false,
  requisitesManual: false,
  parentDocument: null,
  counterparty: {
    id: 'cp1', name: 'ООО «АЙЛАБМЕД»', inn: '7714415572', kpp: '771401002',
    ogrn: '1157746000001', legalAddress: 'г. Москва, ул. Ленина, д. 2',
    email: null, phone: null,
    bankDetails: [{ bankName: 'Сбербанк', checkingAccount: '40702810900000000002', bik: '044525225', correspondentAccount: '30101810400000000225' }],
  },
  profile: {
    type: 'COMPANY', name: 'ООО «Догодок»', inn: '7714415571', kpp: '771401001',
    ogrn: '1157746000000', ogrnDate: null, legalAddress: 'г. Москва, ул. Тверская, д. 1',
    signatorName: 'Иванов Иван Иванович', signatorPosition: 'генеральный директор',
    signatorBasis: 'CHARTER', email: null,
    bankDetails: [{ bankName: 'Тинькофф', checkingAccount: '40702810900000000001', bik: '044525974', correspondentAccount: '30101810145250000974' }],
  },
}

const ДЕФОЛТНЫЙ = {
  id: 'sig1', counterpartyId: 'cp1', fullName: 'Петров Пётр Петрович',
  position: 'президент', basisType: 'CHARTER', poaNumber: null, isDefault: true,
  createdAt: new Date('2026-01-01'),
}
const ВЫБРАННЫЙ = {
  id: 'sig2', counterpartyId: 'cp1', fullName: 'Сидоров Сидор Сидорович',
  position: 'коммерческий директор', basisType: 'CHARTER', poaNumber: null, isDefault: false,
  createdAt: new Date('2026-02-01'),
}

type Q = { where: { id?: string; counterpartyId: string } }
const { signatoryFindFirst } = vi.hoisted(() => ({
  signatoryFindFirst: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    document: { findUnique: async () => docRow },
    signatory: { findFirst: signatoryFindFirst },
  },
}))

vi.mock('@/lib/structure-uploaded', () => ({
  getStructuredContentCached: async (_v: string, content: string | null) => content ?? '',
  looksLikeUpload: () => true,
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { getPresentationContent } from '@/lib/presentation-content'

// Тело должно упоминать ОБЕ стороны: перед подстановкой блоков система сверяет
// стороны документа с карточками ЛК, чтобы не вклеить чужие реквизиты.
const ТЕЛО = [
  '<h1>ДОГОВОР ПОДРЯДА № 44/К</h1>',
  '<p>г. Ульяновск, 3 февраля 2026 г.</p>',
  '<p>ООО «Догодок», именуемое в дальнейшем «Заказчик», и ООО «АЙЛАБМЕД» в лице президента Петрова Петра Петровича, именуемое в дальнейшем «Исполнитель», заключили настоящий договор о нижеследующем:</p>',
  '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
  '<p>1.1. Исполнитель обязуется выполнить работы по монтажу лабораторного оборудования, а Заказчик обязуется принять результат работ и оплатить его в порядке и сроки, установленные настоящим договором.</p>',
  '<h2>2. СТОИМОСТЬ РАБОТ И ПОРЯДОК РАСЧЁТОВ</h2>',
  '<p>2.1. Стоимость работ составляет 1 200 000 (один миллион двести тысяч) рублей, включая все налоги и сборы.</p>',
  '<h2>3. РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2>',
  '<p><strong>Заказчик:</strong></p>',
  '<p>ООО «Догодок», ИНН: 7714415571</p>',
  '<p><strong>Исполнитель:</strong></p>',
  '<p>ООО «АЙЛАБМЕД», ИНН: 7714415572</p>',
].join('\n')

const present = () => getPresentationContent('v1', 'doc1', ТЕЛО, 'u1', 'customer')

beforeEach(() => {
  docRow.number = '17/03'
  docRow.preambleHtml = null
  docRow.requisitesHtml = null
  docRow.preambleManual = false
  docRow.requisitesManual = false
  docRow.decorSignatoryId = null
  signatoryFindFirst.mockReset()
  signatoryFindFirst.mockImplementation(async (q: Q) =>
    q.where.id === 'sig2' ? ВЫБРАННЫЙ : q.where.counterpartyId === 'cp1' ? ДЕФОЛТНЫЙ : null)
})

describe('шапка, которую не трогали руками, пересобирается', () => {
  it('после смены номера в шапке НОВЫЙ номер, а не сохранённый старый', async () => {
    docRow.preambleHtml = СТАРАЯ_ШАПКА
    docRow.number = '99/12-99'

    const out = await present()
    expect(out).toContain('99/12-99')
    expect(out).not.toContain('17/03')
  })

  it('город из шага «Оформление» не теряется при пересборке', async () => {
    docRow.preambleHtml = СТАРАЯ_ШАПКА
    const out = await present()
    expect(out).toContain('Ульяновск')
  })
})

describe('шапка, поправленная руками, не трогается никогда', () => {
  it('ручной текст остаётся, даже когда номер документа изменился', async () => {
    docRow.preambleHtml = РУЧНАЯ_ШАПКА
    docRow.preambleManual = true
    docRow.number = '99/12-99'

    const out = await present()
    expect(out).toContain('ДОГОВОР ОСОБОГО ВИДА № РУЧ-1')
    expect(out).not.toContain('99/12-99')
  })
})

describe('реквизиты', () => {
  it('без ручной правки собираются из актуальных карточек', async () => {
    const out = await present()
    expect(out).toContain('БИК: 044525974')
    expect(out).toContain('БИК: 044525225')
  })

  it('с ручной правкой остаются как есть и НЕ затираются данными из карточек', async () => {
    docRow.requisitesHtml = РУЧНЫЕ_РЕКВИЗИТЫ
    docRow.requisitesManual = true

    const out = await present()
    expect(out).toContain('ОСОБЫЕ РЕКВИЗИТЫ, ВПИСАННЫЕ ЧЕЛОВЕКОМ')
    expect(out).not.toContain('БИК: 044525974')
  })
})

describe('подписант из шага «Оформление»', () => {
  it('берётся выбранный, а не дефолтный', async () => {
    docRow.decorSignatoryId = 'sig2'
    const out = await present()
    expect(out).toContain('Сидоров Сидор Сидорович')
    expect(out).not.toContain('Петров Пётр Петрович')
  })

  it('без явного выбора берётся дефолтный', async () => {
    const out = await present()
    expect(out).toContain('Петров Пётр Петрович')
  })
})
