// Сборка контента загруженного документа для показа и выгрузки.
//
// Две жалобы владельца (2026-08-20), закрытые здесь:
//  1) загрузил договор со своей готовой шапкой — система показала СВОЮ шапку.
//     Теперь шапка из файла остаётся, подменяем её только если пользователь сам
//     согласовал шапку на шаге «Оформление» (Document.preambleHtml);
//  2) подписант контрагента не подтягивался, если не отмечен «по умолчанию» —
//     здесь стоял жёсткий isDefault:true вместо общего резолвера из party-data.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const docRow = {
  id: 'doc1',
  type: 'CONTRACT',
  number: '19/03-ЛАБ',
  documentNumber: null,
  signingDate: null,
  preambleHtml: null as string | null,
  requisitesHtml: null as string | null,
  counterparty: {
    id: 'cp1',
    name: 'ООО «АЙЛАБМЕД»',
    inn: '7714415572',
    kpp: '771401002',
    ogrn: '1157746000001',
    legalAddress: 'г. Москва, ул. Ленина, д. 2',
    email: null,
    phone: null,
    bankDetails: [{ bankName: 'Сбербанк', checkingAccount: '40702810900000000002', bik: '044525225', correspondentAccount: '30101810400000000225' }],
  },
  profile: {
    type: 'COMPANY',
    name: 'ООО «Догодок»',
    inn: '7714415571',
    kpp: '771401001',
    ogrn: '1157746000000',
    ogrnDate: null,
    legalAddress: 'г. Москва, ул. Тверская, д. 1',
    signatorName: 'Иванов Иван Иванович',
    signatorPosition: 'генеральный директор',
    signatorBasis: 'CHARTER',
    email: null,
    bankDetails: [{ bankName: 'Тинькофф', checkingAccount: '40702810900000000001', bik: '044525974', correspondentAccount: '30101810145250000974' }],
  },
}

type SignatoryQuery = { where: { counterpartyId: string; isDefault?: boolean }; orderBy: Array<Record<string, string>> }
// vi.mock поднимается наверх файла, поэтому шпион создаём через vi.hoisted.
// Подписант заполнен, но «по умолчанию» НЕ отмечен — ровно случай владельца.
const { signatoryFindFirst } = vi.hoisted(() => ({
  signatoryFindFirst: vi.fn(async (query: SignatoryQuery) =>
    query.where.counterpartyId === 'cp1'
      ? {
          id: 'sig1',
          counterpartyId: 'cp1',
          fullName: 'Петров Пётр Петрович',
          position: 'президент',
          basisType: 'CHARTER',
          poaNumber: null as string | null,
          isDefault: false,
          createdAt: new Date('2026-01-01'),
        }
      : null,
  ),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    document: { findUnique: async () => docRow },
    signatory: { findFirst: signatoryFindFirst },
  },
}))

// Структурирование загруженного документа — тяжёлая операция с ИИ, в юнит-тесте
// подменяем её тождественной: проверяем именно подстановку блоков.
vi.mock('@/lib/structure-uploaded', () => ({
  getStructuredContentCached: async (_versionId: string, content: string | null) => content ?? '',
  looksLikeUpload: () => true,
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { getPresentationContent } from '@/lib/presentation-content'

// Загруженный договор: своя шапка (заголовок, город/дата, представление сторон),
// тело и свой блок реквизитов.
const UPLOADED = [
  '<h1>ДОГОВОР ПОДРЯДА № 44/К</h1>',
  '<p>г. Ульяновск, 3 февраля 2026 г.</p>',
  '<p>ООО «Догодок», именуемое в дальнейшем «Заказчик», и ООО «АЙЛАБМЕД» в лице президента Петрова Петра Петровича, именуемое в дальнейшем «Исполнитель», заключили настоящий договор о нижеследующем:</p>',
  '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
  '<p>1.1. Исполнитель обязуется выполнить работы по монтажу лабораторного оборудования, а Заказчик обязуется принять результат работ и оплатить его в порядке и сроки, установленные настоящим договором.</p>',
  '<p>1.2. Перечень, объём и стоимость работ определяются сметой, являющейся неотъемлемой частью настоящего договора.</p>',
  '<h2>2. СТОИМОСТЬ РАБОТ И ПОРЯДОК РАСЧЁТОВ</h2>',
  '<p>2.1. Стоимость работ составляет 1 200 000 (один миллион двести тысяч) рублей, включая все налоги и сборы, предусмотренные законодательством Российской Федерации.</p>',
  '<p>2.2. Оплата производится в течение десяти рабочих дней с момента подписания сторонами акта сдачи-приёмки выполненных работ.</p>',
  '<h2>3. РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2>',
  '<p><strong>Заказчик:</strong></p>',
  '<p>ООО «Догодок», ИНН: 7714415571</p>',
  '<p><strong>Исполнитель:</strong></p>',
  '<p>ООО «АЙЛАБМЕД», ИНН: 7714415572</p>',
].join('\n')

async function present() {
  return getPresentationContent('v1', 'doc1', UPLOADED, 'u1', 'customer')
}

beforeEach(() => {
  docRow.preambleHtml = null
  docRow.requisitesHtml = null
  signatoryFindFirst.mockClear()
})

describe('getPresentationContent — шапка загруженного документа', () => {
  it('шапка из файла остаётся: свой заголовок, город и абзац сторон на месте', async () => {
    const out = await present()
    expect(out).toContain('ДОГОВОР ПОДРЯДА № 44/К')
    expect(out).toContain('г. Ульяновск, 3 февраля 2026 г.')
    expect(out).toContain('именуемое в дальнейшем «Заказчик»')
    // Никакой нашей шапки поверх пользовательской
    expect(out).not.toContain('doc-preamble-title')
    expect(out).not.toContain('doc-preamble-meta')
  })

  it('согласованная на шаге «Оформление» шапка имеет приоритет и подменяет файловую', async () => {
    docRow.preambleHtml = '<p class="doc-preamble-title ta-center"><strong>ДОГОВОР № 19/03-ЛАБ</strong></p>'
    const out = await present()
    expect(out).toContain('ДОГОВОР № 19/03-ЛАБ')
    expect(out).not.toContain('ДОГОВОР ПОДРЯДА № 44/К')
  })

  it('блок реквизитов по-прежнему подставляется из ЛК (задача только про шапку)', async () => {
    const out = await present()
    expect(out).toContain('doc-requisites')
    expect(out).toContain('БИК: 044525974') // реквизиты из профиля ЛК
    expect(out).toContain('БИК: 044525225') // реквизиты из карточки контрагента
  })

  it('тело договора не пострадало', async () => {
    const out = await present()
    expect(out).toContain('1. ПРЕДМЕТ ДОГОВОРА')
    expect(out).toContain('2. СТОИМОСТЬ РАБОТ И ПОРЯДОК РАСЧЁТОВ')
    expect(out).toContain('1 200 000')
  })
})

describe('getPresentationContent — подписант контрагента', () => {
  it('подписант без флага «по умолчанию» подтягивается в блок реквизитов', async () => {
    const out = await present()
    expect(out).toContain('Петров Пётр Петрович')
    expect(out).toContain('президент')
  })

  it('используется общий резолвер party-data: фолбэк по isDefault desc, а не жёсткий фильтр', async () => {
    await present()
    expect(signatoryFindFirst).toHaveBeenCalledTimes(1)
    const args = signatoryFindFirst.mock.calls[0]![0]
    expect(args.where).toEqual({ counterpartyId: 'cp1' })
    expect(args.where.isDefault).toBeUndefined()
    expect(args.orderBy).toEqual([{ isDefault: 'desc' }, { createdAt: 'asc' }])
  })
})
