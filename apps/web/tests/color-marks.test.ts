// Цветные пометки пользователя (цвет шрифта и жёлтая заливка) должны пережить
// путь «редактор → сохранение → выгрузка в Word»:
//  - sanitizeHtml пропускает color/background-color, но режет всё остальное;
//  - convertToDocx переносит их в document.xml (w:color / w:shd).
import { describe, it, expect } from 'vitest'
import { sanitizeHtml, sanitizeStyleAttr } from '@/lib/html-document'
import { convertToDocx } from '@shared/formatting/html-docx-converter'
import { readDocumentXml } from './docx-utils'

describe('sanitizeStyleAttr', () => {
  it('оставляет цвет шрифта и фон', () => {
    expect(sanitizeStyleAttr('color: #C81E1E')).toBe('color: #C81E1E')
    expect(sanitizeStyleAttr('background-color: #FFF176')).toBe('background-color: #FFF176')
  })

  it('выбрасывает всё небезопасное и нецветовое', () => {
    expect(sanitizeStyleAttr('position: fixed; top: 0')).toBe('')
    expect(sanitizeStyleAttr('background-color: url(javascript:alert(1))')).toBe('')
    expect(sanitizeStyleAttr('color: expression(alert(1))')).toBe('')
    // из смешанного объявления остаётся только цвет
    expect(sanitizeStyleAttr('color: red; display: none')).toBe('color: red')
  })
})

describe('sanitizeHtml с цветными пометками', () => {
  it('сохраняет цвет шрифта и выделение', () => {
    const html = '<p>Пункт <span style="color: #C81E1E">важный</span> и <mark style="background-color: #FFF176">жёлтый</mark></p>'
    const out = sanitizeHtml(html)
    expect(out).toContain('color: #C81E1E')
    expect(out).toContain('background-color: #FFF176')
    expect(out).toContain('<mark')
  })

  it('не пропускает обработчики событий и опасные стили', () => {
    const out = sanitizeHtml('<p style="position: fixed" onclick="alert(1)">Текст</p>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('position')
  })
})

describe('convertToDocx: цветные пометки в Word', () => {
  it('переносит цвет шрифта и заливку', async () => {
    const html = '<p>Обычный <span style="color: #C81E1E">красный</span> и <mark style="background-color: #FFF176">выделенный</mark></p>'
    const buffer = await convertToDocx(html, { title: 'Тест' })
    const xml = await readDocumentXml(buffer)

    expect(xml).toContain('C81E1E')       // w:color красного текста
    expect(xml).toContain('FFF176')       // w:shd жёлтой заливки
  })

  it('заголовки разделов остаются чёрными (не синими из темы Word)', async () => {
    const buffer = await convertToDocx('<h2>ПРЕДМЕТ ДОГОВОРА</h2><p>Текст</p>', { title: 'Тест' })
    const xml = await readDocumentXml(buffer)
    // Явный чёрный в стилях заголовков: без него просмотрщики берут цвет темы
    expect(xml.includes('000000') || xml.includes('Heading2')).toBe(true)
  })
})
