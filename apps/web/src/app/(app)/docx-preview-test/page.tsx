'use client'

/**
 * ПРОТОТИП (оценка): точный просмотр загруженного .docx через docx-preview
 * (Apache-2.0, бесплатно для коммерции). Рендерит документ 1-в-1, как в Word —
 * в отличие от mammoth, который теряет оформление. Только просмотр (read-only).
 *
 * Это тестовая страница для сравнения точности. В прод-поток не подключена.
 */

import { useCallback, useRef, useState } from 'react'

export default function DocxPreviewTestPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const render = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'docx') {
      setError('Нужен файл .docx (старый .doc docx-preview не читает — пересохраните в Word как .docx)')
      return
    }
    setError(null)
    setFileName(file.name)
    setLoading(true)
    try {
      // Клиентская библиотека — грузим динамически (без SSR)
      const { renderAsync } = await import('docx-preview')
      const buf = await file.arrayBuffer()
      const container = containerRef.current
      if (!container) return
      container.innerHTML = ''
      await renderAsync(buf, container, undefined, {
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
      } as Record<string, unknown>)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) void render(f)
  }, [render])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 6 }}>
        Прототип: точный просмотр .docx (docx-preview)
      </h1>
      <p style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 20 }}>
        Загрузите тот же Word-файл — он отрисуется 1-в-1, как в Word (без нашего mammoth-упрощения).
        Это только просмотр, для оценки точности.
      </p>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line-2)'}`,
          borderRadius: 12,
          padding: '28px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'oklch(0.97 0.01 260)' : 'var(--surface)',
          marginBottom: 16,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void render(f) }}
        />
        <p style={{ fontSize: 14, fontWeight: 500 }}>
          {fileName ? `Файл: ${fileName} — нажмите, чтобы заменить` : 'Перетащите .docx или нажмите'}
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
          Файл обрабатывается локально в браузере и никуда не отправляется
        </p>
      </div>

      {loading && <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Рендерим…</p>}
      {error && <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>}

      <div
        style={{
          border: '1px solid var(--line-2)',
          borderRadius: 12,
          background: '#eee',
          padding: 16,
          overflow: 'auto',
          minHeight: 200,
        }}
      >
        <div ref={containerRef} className="docx-preview-host" />
      </div>
    </div>
  )
}
