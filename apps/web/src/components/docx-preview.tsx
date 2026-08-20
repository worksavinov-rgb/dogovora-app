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

export function DocxPreview({
  docx,
  loading = false,
  className,
}: {
  docx: ArrayBuffer | null
  loading?: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)

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
        setRendering(false)
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
