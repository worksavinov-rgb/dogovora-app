'use client'

/**
 * Точный рендер .docx через docx-preview (Apache-2.0). Рисует документ 1-в-1,
 * как в Word. Библиотека работает только в браузере — грузится динамически.
 *
 * Компонент «глупый»: получает готовые байты .docx и рисует их. Откуда байты
 * (оригинал загруженного файла или собранный из текущего HTML .docx) — решает
 * рабочий экран. При смене `docx` рендер перерисовывается.
 */

import { useEffect, useRef, useState } from 'react'

// Опции подобраны на прототипе: постранично, с колонтитулами/сносками, картинки
// как data-URL (строгий CSP разрешает img-src data:). inWrapper рисует «страницы»
// с белым фоном и тенью — бумажный вид Word.
const RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreWidth: false,
  ignoreHeight: false,
  experimental: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  useBase64URL: true,
} as const

// Маркеры списков Word задаются символьными шрифтами (Wingdings/Symbol), которых
// в браузере нет — docx-preview рисует их «тофу»-квадратами. Шрифты проприетарные,
// подложить их нельзя, поэтому переводим сами коды в юникод-эквиваленты.
const SYMBOL_FONT = /wingdings|symbol|webdings/i
const BULLET_MAP: Record<string, string> = {
  '': '▪', '§': '▪', // § — квадратный маркер
  '': '•', '·': '•', // · — круглый маркер
  '': '✓', 'ü': '✓', // ü — галочка
  '': '➢', 'Ø': '➢', // Ø — стрелка
  '': '●', l: '●',
  '': '■', n: '■',
  '': '❑', u: '❑',
  '': '❖', v: '❖',
  '': '▫', '¨': '▫',
}

/** Заменяет символы из Wingdings/Symbol на видимые юникод-маркеры. */
function fixSymbolBullets(root: HTMLElement): void {
  const nodes = root.querySelectorAll<HTMLElement>('[style*="font-family"]')
  nodes.forEach((el) => {
    if (!SYMBOL_FONT.test(el.style.fontFamily)) return
    const text = el.textContent ?? ''
    // Маркер — это одиночный символ; длинный текст таким шрифтом не трогаем,
    // чтобы не испортить содержательные фрагменты документа.
    if (text.trim().length > 2) return
    const replaced = [...text].map((ch) => BULLET_MAP[ch] ?? ch).join('')
    if (replaced !== text) el.textContent = replaced
    // Символьный шрифт снимаем в любом случае — иначе останется «тофу».
    el.style.fontFamily = 'inherit'
  })
}

// ─── Разбивка на страницы по высоте ──────────────────────────────────────────
// Почему нужна: docx-preview рисует «страницы», разрезая документ только по ЯВНЫМ
// разрывам (w:br type=page / w:lastRenderedPageBreak). Настоящие Word-файлы такие
// маркеры содержат — поэтому загруженные документы красиво бьются на листы. А наши
// собранные из HTML .docx (генерация ИИ, ручные/ИИ-правки) их не имеют, и весь
// документ выходит одним бесконечным листом. Здесь мы добираем недостающее: если
// docx-preview выдал ОДИН лист, а контент выше страницы — режем его на листы А4 по
// измеренной высоте, клонируя оболочку страницы (те же класс/поля/размер).
//
// Консервативно и безопасно: работаем только когда лист ровно один (нативные
// разрывы не трогаем), только переносим узлы (ничего не режем внутри), при любой
// ошибке оставляем исходный один лист. Блок выше страницы (длинная таблица) кладём
// на отдельный лист как есть — пусть слегка перельётся, это прежнее поведение.
function outerHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  return el.getBoundingClientRect().height + parseFloat(cs.marginTop || '0') + parseFloat(cs.marginBottom || '0')
}

function paginateByHeight(container: HTMLElement): void {
  const wrapper = container.querySelector<HTMLElement>('.docx-wrapper') ?? container
  const pages = Array.from(wrapper.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.tagName === 'SECTION',
  )
  // Ровно один лист = нативных разрывов нет. Иначе — оставляем как есть.
  if (pages.length !== 1) return
  const page = pages[0]
  const article = page.querySelector<HTMLElement>(':scope > article')
  if (!article) return

  const cs = getComputedStyle(page)
  const pageHeight = parseFloat(cs.minHeight || '0')
  const padTop = parseFloat(cs.paddingTop || '0')
  const padBottom = parseFloat(cs.paddingBottom || '0')
  if (!pageHeight) return
  const avail = pageHeight - padTop - padBottom
  if (avail <= 0) return

  // Уже помещается на один лист — делить нечего (небольшой допуск на округления).
  if (article.getBoundingClientRect().height <= avail + 2) return

  const blocks = Array.from(article.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
  if (blocks.length <= 1) return

  // Собираем группы блоков, каждая ≤ высоты листа.
  const groups: HTMLElement[][] = []
  let current: HTMLElement[] = []
  let used = 0
  for (const block of blocks) {
    const h = outerHeight(block)
    if (current.length > 0 && used + h > avail) {
      groups.push(current)
      current = []
      used = 0
    }
    current.push(block)
    used += h
  }
  if (current.length > 0) groups.push(current)
  if (groups.length <= 1) return

  // Клонируем оболочку листа (без контента) и раскладываем группы по листам.
  const frag = document.createDocumentFragment()
  for (const group of groups) {
    const newPage = page.cloneNode(false) as HTMLElement
    const newArticle = article.cloneNode(false) as HTMLElement
    for (const block of group) newArticle.appendChild(block) // перенос узла (не копия)
    newPage.appendChild(newArticle)
    frag.appendChild(newPage)
  }
  wrapper.replaceChild(frag, page)
}

export function DocxPreview({
  docx,
  loading = false,
  className,
  onRendered,
}: {
  docx: ArrayBuffer | null
  loading?: boolean
  className?: string
  /** Документ отрисован — родитель может вернуть прокрутку на прежнее место */
  onRendered?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const onRenderedRef = useRef(onRendered)
  useEffect(() => { onRenderedRef.current = onRendered }, [onRendered])

  useEffect(() => {
    if (!docx) return
    let cancelled = false
    // setState — внутри async-обёртки, а не синхронно в теле эффекта: рендер
    // документа библиотекой docx-preview это синхронизация с внешней системой.
    const run = async () => {
      setError(null)
      setRendering(true)
      try {
        const { renderAsync } = await import('docx-preview')
        const container = containerRef.current
        if (!container || cancelled) return
        container.innerHTML = ''
        // renderAsync мутирует буфер (переносит владение), поэтому копию не
        // переиспользуем — экран всегда передаёт свежие байты.
        await renderAsync(docx, container, undefined, RENDER_OPTIONS as Record<string, unknown>)
        if (cancelled) return
        fixSymbolBullets(container)
        // Добираем постраничную разбивку для документов без явных разрывов
        // (собранные из HTML). Изолируем: сбой пагинации не должен рушить показ.
        try { paginateByHeight(container) } catch { /* остаётся один лист */ }
        setRendering(false)
        onRenderedRef.current?.()
      } catch (e) {
        if (cancelled) return
        setRendering(false)
        setError(e instanceof Error ? e.message : 'Не удалось отрисовать документ')
      }
    }
    void run()
    return () => { cancelled = true }
  }, [docx])

  const busy = loading || rendering

  return (
    <div className={className} style={{ position: 'relative' }}>
      {busy && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{ background: 'rgba(222,218,211,0.6)' }}
        >
          <div className="flex items-center gap-[8px] px-[14px] py-[7px] rounded-full shadow-md"
            style={{ background: 'var(--ink)', color: 'var(--bg)' }}>
            <div className="w-[10px] h-[10px] rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <span className="text-[12px] font-medium">Готовим точный вид…</span>
          </div>
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center justify-center h-[300px] gap-[8px] text-center px-6">
          <p className="text-[13px] font-medium text-[var(--ink)]">Не удалось показать точный вид</p>
          <p className="text-[12px] text-[var(--ink-4)] max-w-[320px]">{error}</p>
        </div>
      )}
      <div ref={containerRef} className="docx-preview-host" style={{ display: error ? 'none' : 'block' }} />
    </div>
  )
}
