// Регресс дублирования реквизитов: Word-блок реквизитов приходит как
// div.doc-layout-table с ВЛОЖЕННЫМИ div.doc-layout-cell. Прежний topLevelBlocks
// (нежадный `<div>[\s\S]*?</div>`) обрывался на первом </div> и распознавал блок
// обрезанным — замена ломалась, Word-реквизиты оставались, а системные
// дописывались сверху. Теперь блок распознаётся целиком и заменяется целиком.
import { describe, it, expect } from 'vitest'
import { replaceRequisitesSection } from '@/lib/html-document'

const BODY = [
  '<h1>ДОГОВОР № 19/03-ЛАБ</h1>',
  '<p>Преамбула сторон.</p>',
  '<h2>1. ПРЕДМЕТ ДОГОВОРА</h2>',
  '<p>1.1. Исполнитель оказывает услуги.</p>',
].join('\n')

// Двухколоночный блок реквизитов из Word (mammoth → postProcessMammothHtml)
const WORD_LAYOUT = [
  '<div class="doc-layout-table">',
  '<div class="doc-layout-cell"><p><strong>Исполнитель:</strong></p><p>Савинов Павел Александрович</p><p>ИНН: 730901700292</p><p>Р/счет: 40802810800009200347</p></div>',
  '<div class="doc-layout-cell"><p><strong>Заказчик:</strong></p><p>ООО «АЙЛАБМЕД»</p><p>ИНН: 7714415571</p><p>БИК: 044525545</p></div>',
  '</div>',
].join('')

const SYSTEM_REQS = '<div class="doc-requisites"><div class="doc-requisites-col"><p>Системные реквизиты сторон</p></div></div>'

describe('replaceRequisitesSection — вложенный Word-блок doc-layout-table', () => {
  it('заменяет линейный Word-блок под заголовком «ЮРИДИЧЕСКИЕ АДРЕСА…»', () => {
    // Реквизиты идут простыми <p> (mammoth не распознал таблицу) под типичным
    // российским заголовком — раньше REQS_HEADER_RE его не ловил, Word-блок оставался.
    const html = [
      BODY,
      '<h2>ЮРИДИЧЕСКИЕ АДРЕСА И РЕКВИЗИТЫ СТОРОН</h2>',
      '<p><strong>Исполнитель:</strong></p>',
      '<p>Савинов Павел Александрович</p>',
      '<p>ИНН: 730901700292</p>',
      '<p>Р/счет: 40802810800009200347</p>',
      '<p><strong>Заказчик:</strong></p>',
      '<p>ООО «АЙЛАБМЕД»</p>',
      '<p>ИНН: 7714415571</p>',
    ].join('\n')
    const { html: out, replaced } = replaceRequisitesSection(html, SYSTEM_REQS)

    expect(replaced).toBe(true)
    expect(out).toContain('Системные реквизиты сторон')
    // Данные из Word вырезаны
    expect(out).not.toContain('730901700292')
    expect(out).not.toContain('7714415571')
    // Заголовок раздела сохранён (нумерация разделов не сбивается)
    expect(out).toContain('ЮРИДИЧЕСКИЕ АДРЕСА И РЕКВИЗИТЫ СТОРОН')
    expect(out).toContain('1. ПРЕДМЕТ ДОГОВОРА')
  })

  it('убирает осиротевший заголовок-<li> и хвост подписей после блока реквизитов', () => {
    // Реальный кейс: заголовок «ЮРИДИЧЕСКИЕ АДРЕСА…» попал в <li> списка разделов,
    // за реквизитами идёт ОТДЕЛЬНЫЙ блок подписей. Должны остаться только тело + один
    // системный блок: без заголовка-сироты и без хвоста подписей.
    const html = [
      '<ol><li><p>ПРЕДМЕТ ДОГОВОРА</p></li>',
      '<li><p>РАЗРЕШЕНИЕ СПОРОВ</p></li>',
      '<li><strong>ЮРИДИЧЕСКИЕ АДРЕСА И РЕКВИЗИТЫ СТОРОН</strong></li></ol>',
      '<div class="doc-layout-table"><div class="doc-layout-cell"><p>Исполнитель:</p><p>ИНН: 730901700292</p></div><div class="doc-layout-cell"><p>Заказчик:</p><p>ИНН: 7714415571</p></div></div>',
      '<table><tbody><tr><td><p>Заказчик:</p><p>/Темкин М.М./</p></td><td><p>Исполнитель:</p><p>/Савинов П.А./</p></td></tr></tbody></table>',
    ].join('\n')
    const { html: out, replaced } = replaceRequisitesSection(html, SYSTEM_REQS)

    expect(replaced).toBe(true)
    expect(out).toContain('Системные реквизиты сторон')
    // Осиротевший заголовок убран
    expect(out).not.toContain('ЮРИДИЧЕСКИЕ АДРЕСА')
    // Хвост подписей (Темкин/Савинов) убран
    expect(out).not.toContain('Темкин')
    expect(out).not.toContain('Савинов')
    // Данные Word убраны, тело цело
    expect(out).not.toContain('730901700292')
    expect(out).toContain('ПРЕДМЕТ ДОГОВОРА')
    // Список разделов не сломан (закрывающий </ol> на месте)
    expect(out).toContain('</ol>')
    // Ровно один системный блок
    expect(out.match(/class="doc-requisites"/g)?.length).toBe(1)
  })

  it('заменяет ВЕСЬ двухколоночный Word-блок системным (без дубля и обрезков)', () => {
    const html = [BODY, WORD_LAYOUT].join('\n')
    const { html: out, replaced } = replaceRequisitesSection(html, SYSTEM_REQS)

    expect(replaced).toBe(true)
    // Системный блок вставлен
    expect(out).toContain('Системные реквизиты сторон')
    // Word-реквизиты вырезаны целиком — ни одной колонки не осталось
    expect(out).not.toContain('doc-layout-table')
    expect(out).not.toContain('doc-layout-cell')
    expect(out).not.toContain('730901700292')
    expect(out).not.toContain('7714415571')
    // Тело документа не тронуто
    expect(out).toContain('1. ПРЕДМЕТ ДОГОВОРА')
    // Ровно один системный блок-контейнер (нет дублирования)
    expect(out.match(/class="doc-requisites"/g)?.length).toBe(1)
  })
})
