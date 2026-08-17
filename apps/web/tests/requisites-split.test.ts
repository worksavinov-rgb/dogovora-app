// Защитные тесты splitRequisitesBlock — отделение «подвала» с реквизитами/подписями
// от тела договора. Именно здесь был регресс «потеря 40% текста и приложений»:
// раздел «13. Место нахождения и банковские реквизиты Сторон» в СЕРЕДИНЕ документа
// принимался за подвал, и всё после него (включая приложения) отрезалось.
import { describe, it, expect } from 'vitest'
import { splitRequisitesBlock } from '@/lib/html-document'

// ─── Утилиты ──────────────────────────────────────────────────────────────────

/** Плоский текст HTML: без тегов, с нормализованными пробелами. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Текст без пробелов вообще — для сравнения «ничего не потеряно». */
function compactText(html: string): string {
  return plainText(html).replace(/\s+/g, '')
}

// ─── Фикстуры (структура как в реальном загруженном договоре РООУ) ────────────

/** Разделы тела договора до блока реквизитов. */
const CONTRACT_BODY = [
  '<h1>ДОГОВОР № 12/25 на оказание услуг по организации мероприятия</h1>',
  '<p>г. Москва</p>',
  '<p>Региональная общественная организация, именуемая в дальнейшем «Заказчик», в лице Президента, действующего на основании Устава, с одной стороны, и ИП Савинов П.А., именуемый в дальнейшем «Исполнитель», с другой стороны, заключили настоящий Договор о нижеследующем:</p>',
  '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
  '<p>1.1. Исполнитель обязуется оказать услуги по организации и проведению мероприятия, а Заказчик обязуется принять и оплатить оказанные услуги.</p>',
  '<p>1.2. Перечень, объём и сроки оказания услуг согласовываются Сторонами в Заявках, являющихся неотъемлемой частью настоящего Договора.</p>',
  '<h2>2. ПРАВА И ОБЯЗАННОСТИ СТОРОН</h2>',
  '<p>2.1. Исполнитель обязан оказать услуги качественно и в согласованные сроки.</p>',
  '<p>2.2. Заказчик обязан своевременно предоставить Исполнителю необходимые материалы и информацию.</p>',
  '<h2>12. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ</h2>',
  '<p>12.1. Договор вступает в силу с момента подписания и действует до полного исполнения Сторонами обязательств.</p>',
].join('\n')

/** Блок реквизитов простыми абзацами (как приходит из Word через mammoth). */
const REQUISITES_SECTION = [
  '<h2>13. МЕСТО НАХОЖДЕНИЯ И БАНКОВСКИЕ РЕКВИЗИТЫ СТОРОН</h2>',
  '<p><strong>Заказчик:</strong></p>',
  '<p>Региональная общественная организация урологов</p>',
  '<p>ИНН: 7707083893</p>',
  '<p>КПП: 770701001</p>',
  '<p>БИК: 044525225</p>',
  '<p>Р/счет: 40702810400000012345</p>',
  '<p><strong>Исполнитель:</strong></p>',
  '<p>ИП Савинов Павел Андреевич</p>',
  '<p>ИНН: 502906602876</p>',
  '<p>БИК: 044525974</p>',
  '<p>Р/счет: 40802810900001234567</p>',
].join('\n')

/** Два приложения после реквизитов (регресс: они отрезались вместе с «подвалом»). */
const APPENDICES = [
  '<h2>ПРИЛОЖЕНИЕ №1 к Договору № 12/25</h2>',
  '<h2>ЗАЯВКА на оказание услуг</h2>',
  '<p>Наименование мероприятия: ежегодная конференция. Дата проведения: 12 октября 2025 года. Место проведения: конгресс-центр.</p>',
  '<table><thead><tr><th>Услуга</th><th>Количество</th><th>Стоимость</th></tr></thead>',
  '<tbody><tr><td>Аренда зала</td><td>1</td><td>150 000 руб.</td></tr>',
  '<tr><td>Техническое сопровождение</td><td>2</td><td>80 000 руб.</td></tr></tbody></table>',
  '<h2>ПРИЛОЖЕНИЕ №2 к Договору № 12/25</h2>',
  '<p>Форма акта сдачи-приёмки оказанных услуг. Услуги оказаны в полном объёме, Стороны претензий друг к другу не имеют.</p>',
].join('\n')

// ─── Тесты ────────────────────────────────────────────────────────────────────

describe('splitRequisitesBlock', () => {
  it('реквизиты в середине документа + приложения после: приложения НЕ попадают в отрезанный блок', () => {
    const html = [CONTRACT_BODY, REQUISITES_SECTION, APPENDICES].join('\n')
    const { body, requisites } = splitRequisitesBlock(html)

    // Приложения не должны оказаться в «подвале»
    expect(requisites).not.toContain('ПРИЛОЖЕНИЕ №1')
    expect(requisites).not.toContain('ПРИЛОЖЕНИЕ №2')
    // Приложения остаются в теле — иначе ИИ-правка их «съест»
    expect(body).toContain('ПРИЛОЖЕНИЕ №1')
    expect(body).toContain('ЗАЯВКА')
    expect(body).toContain('ПРИЛОЖЕНИЕ №2')
  })

  it('реквизиты в середине + приложения: весь исходный текст сохранён (body + requisites)', () => {
    const html = [CONTRACT_BODY, REQUISITES_SECTION, APPENDICES].join('\n')
    const { body, requisites } = splitRequisitesBlock(html)

    const combined = compactText(body) + compactText(requisites)
    expect(combined).toBe(compactText(html))
  })

  it('реквизиты в самом конце документа: подвал отрезается, текст не теряется', () => {
    const html = [CONTRACT_BODY, REQUISITES_SECTION].join('\n')
    const { body, requisites } = splitRequisitesBlock(html)

    // Подвал найден и содержит реквизиты обеих сторон
    expect(requisites).toContain('МЕСТО НАХОЖДЕНИЯ И БАНКОВСКИЕ РЕКВИЗИТЫ СТОРОН')
    expect(requisites).toContain('7707083893')
    expect(requisites).toContain('502906602876')
    // Тело — без реквизитов, но с последним разделом договора
    expect(body).not.toContain('7707083893')
    expect(body).toContain('12. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ')
    // Ничего не потеряно
    const combined = compactText(body) + compactText(requisites)
    expect(combined).toBe(compactText(html))
  })

  it('подвал таблицей с реквизитами в конце: отрезается вместе с заголовком «Подписи сторон»', () => {
    const table = [
      '<p>Подписи сторон</p>',
      '<table><tbody><tr>',
      '<td><p>Заказчик:</p><p>ИНН: 7707083893</p><p>БИК: 044525225</p></td>',
      '<td><p>Исполнитель:</p><p>ИНН: 502906602876</p><p>БИК: 044525974</p></td>',
      '</tr></tbody></table>',
    ].join('\n')
    const html = [CONTRACT_BODY, table].join('\n')
    const { body, requisites } = splitRequisitesBlock(html)

    expect(requisites).toContain('7707083893')
    expect(requisites).toContain('Подписи сторон') // заголовок-маркер уходит вместе с таблицей
    expect(body).not.toContain('ИНН')
    const combined = compactText(body) + compactText(requisites)
    expect(combined).toBe(compactText(html))
  })

  it('документ без блока реквизитов возвращается нетронутым', () => {
    const { body, requisites } = splitRequisitesBlock(CONTRACT_BODY)
    expect(body).toBe(CONTRACT_BODY)
    expect(requisites).toBe('')
  })

  it('пустая строка → пустое тело и пустые реквизиты', () => {
    const { body, requisites } = splitRequisitesBlock('')
    expect(body).toBe('')
    expect(requisites).toBe('')
  })

  it('системный блок doc-layout-table в конце документа отрезается целиком', () => {
    // Маркеры сторон — с названием в той же строке, чтобы проверить именно ветку
    // с doc-layout-table (голый абзац «Заказчик:» перехватывается более ранней веткой).
    const layout = [
      '<div class="doc-layout-table">',
      '<div class="doc-layout-cell"><p><strong>Заказчик:</strong> Региональная общественная организация</p><p>ИНН: 7707083893</p></div>',
      '<div class="doc-layout-cell"><p><strong>Исполнитель:</strong> ИП Савинов П.А.</p><p>ИНН: 502906602876</p></div>',
      '</div>',
    ].join('')
    const html = [CONTRACT_BODY, layout].join('\n')
    const { body, requisites } = splitRequisitesBlock(html)

    expect(requisites).toContain('doc-layout-table')
    expect(requisites).toContain('7707083893')
    expect(body).not.toContain('doc-layout-table')
    const combined = compactText(body) + compactText(requisites)
    expect(combined).toBe(compactText(html))
  })
})
