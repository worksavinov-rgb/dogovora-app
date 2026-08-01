// Парсинг Word (.docx/.doc) → HTML на клиенте через mammoth.
// Используется и в мастере загрузки нового документа, и при загрузке новой
// версии с правками контрагента на карточке документа.
//
// ВАЖНО: mammoth НЕ разбирает режим рецензирования (tracked changes) и
// комментарии Word — поэтому перед загрузкой пользователя нужно предупредить
// принять все правки и удалить комментарии, иначе текст может исказиться.

// Ключевые слова блока реквизитов/подписей
const REQUISITES_KEYWORDS = /\b(ИНН|КПП|ОГРН|ОГРНИП|Р\/счет|р\/сч|БИК|К\/счет|к\/сч|расчётный счет|корр\. счет|e-mail|E-mail|Исполнитель:|Заказчик:)/i

// Разворачивает layout-таблицы Word в линейные блоки.
// A) Широкие layout-таблицы: ≤3 строк, 2-4 колонки, длинные ячейки
// B) Блоки подписей/реквизитов: 2 колонки с ИНН, Р/счет, БИК и т.д.
function postProcessMammothHtml(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  doc.querySelectorAll('table').forEach((table) => {
    if (table.closest('td, th')) return // пропускаем вложенные

    const directRows = Array.from(table.children)
      .flatMap(el => (el.tagName === 'TBODY' || el.tagName === 'THEAD')
        ? Array.from(el.children) : [el])
      .filter(el => el.tagName === 'TR') as HTMLTableRowElement[]

    if (directRows.length === 0) return

    const directCells = directRows.flatMap(row =>
      Array.from(row.children).filter(el => el.tagName === 'TD' || el.tagName === 'TH')
    )
    if (directCells.length === 0) return

    const cols = Math.max(...directRows.map(r =>
      Array.from(r.children).filter(el => el.tagName === 'TD' || el.tagName === 'TH').length
    ))
    const avgLen = directCells.reduce((s, c) => s + (c.textContent?.length ?? 0), 0) / directCells.length

    const isLayoutBySize = directRows.length <= 3 && cols >= 2 && cols <= 4 && avgLen > 300
    const allCells = Array.from(table.querySelectorAll('td, th'))
    const reqMatchCount = allCells.filter(c => REQUISITES_KEYWORDS.test(c.textContent ?? '')).length
    const isLayoutByContent = cols === 2 && reqMatchCount >= 2

    if (isLayoutBySize || isLayoutByContent) {
      const wrapper = document.createElement('div')
      wrapper.className = 'doc-layout-table'
      directCells.forEach((cell) => {
        const div = document.createElement('div')
        div.className = 'doc-layout-cell'
        div.innerHTML = cell.innerHTML
        wrapper.appendChild(div)
      })
      table.replaceWith(wrapper)
    }
  })

  return doc.body.innerHTML
}

// Word → HTML (сохраняем таблицы и форматирование). mammoth подгружается
// динамически, только в браузере.
export async function parseDocxToHtml(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const { promoteHeadings } = await import('./html-document')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      "p[style-name='Заголовок 1'] => h1:fresh",
      "p[style-name='Заголовок 2'] => h2:fresh",
      "p[style-name='Заголовок 3'] => h3:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Название'] => h1:fresh",
    ],
  })
  // Word часто оформляет заголовки просто жирным абзацем (не «стилем заголовка»),
  // тогда mammoth не делает из них <h1>/<h2>. Достраиваем заголовки эвристикой,
  // чтобы загруженный документ выглядел в предпросмотре так же, как сгенерированный.
  return promoteHeadings(postProcessMammothHtml(result.value))
}
