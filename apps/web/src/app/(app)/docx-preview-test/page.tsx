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
  const [editing, setEditing] = useState(false)
  const [rendered, setRendered] = useState(false)
  // Текущие байты документа (обновляются после ИИ-правки) — база64 для эндпоинта
  const [docxB64, setDocxB64] = useState<string | null>(null)
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)

  // Переключение ручного редактирования прямо на точном рендере docx-preview.
  const toggleEditing = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const next = !editing
    setEditing(next)
    container.contentEditable = next ? 'true' : 'false'
    container.spellcheck = next
    if (next) {
      container.style.outline = 'none'
      container.focus()
    }
  }, [editing])

  // Рендер точного просмотра из байтов .docx
  const renderBuffer = useCallback(async (buf: ArrayBuffer) => {
    const { renderAsync } = await import('docx-preview')
    const container = containerRef.current
    if (!container) return
    container.contentEditable = 'false'
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
    setEditing(false)
    setRendered(true)
  }, [])

  const toB64 = (buf: ArrayBuffer) => {
    let s = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
    return btoa(s)
  }
  const fromB64 = (b64: string) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }

  const render = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'docx') {
      setError('Нужен файл .docx (старый .doc docx-preview не читает — пересохраните в Word как .docx)')
      return
    }
    setError(null)
    setAiNote(null)
    setFileName(file.name)
    setLoading(true)
    try {
      const buf = await file.arrayBuffer()
      setDocxB64(toB64(buf.slice(0)))
      await renderBuffer(buf)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRendered(false)
    } finally {
      setLoading(false)
    }
  }, [renderBuffer])

  // ИИ-правка / переписывание: наш движок editDocument → .docx → перерисовка.
  const runAi = useCallback(async (mode: 'edit' | 'rewrite') => {
    if (!docxB64 || !aiInstruction.trim() || aiLoading) return
    setAiLoading(true)
    setError(null)
    setAiNote(mode === 'rewrite' ? 'ИИ переписывает договор…' : 'ИИ вносит правку…')
    try {
      const res = await fetch('/api/docx-preview-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docxBase64: docxB64, instruction: aiInstruction, mode }),
      })
      const data = await res.json() as { docxBase64?: string; error?: string }
      if (!res.ok || !data.docxBase64) {
        setError(data.error ?? 'ИИ не смог применить правку')
        setAiNote(null)
        return
      }
      setDocxB64(data.docxBase64)
      await renderBuffer(fromB64(data.docxBase64))
      setAiNote(mode === 'rewrite'
        ? 'Готово: договор переписан ИИ. Так он будет выглядеть при скачивании.'
        : 'Готово: правка внесена ИИ. Так документ будет выглядеть при скачивании.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setAiNote(null)
    } finally {
      setAiLoading(false)
    }
  }, [docxB64, aiInstruction, aiLoading, renderBuffer])

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

      {/* Панель режима: просмотр ↔ ручное редактирование прямо на точном рендере */}
      {rendered && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button
            onClick={toggleEditing}
            style={{
              height: 34, padding: '0 16px', borderRadius: 8, cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              background: editing ? 'var(--ink)' : 'var(--surface)',
              color: editing ? '#fff' : 'var(--ink)',
              border: `1px solid ${editing ? 'var(--ink)' : 'var(--line-2)'}`,
            }}
          >
            {editing ? '✓ Готово (просмотр)' : '✏️ Редактировать вручную'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            {editing
              ? 'Режим правки: кликните в текст и печатайте прямо по документу, как в Word.'
              : 'Точный просмотр, как в Word. Нажмите «Редактировать», чтобы править вручную.'}
          </span>
        </div>
      )}

      <div
        style={{
          border: editing ? '2px solid var(--accent)' : '1px solid var(--line-2)',
          borderRadius: 12,
          background: '#eee',
          padding: 16,
          overflow: 'auto',
          minHeight: 200,
          transition: 'border-color 0.15s',
        }}
      >
        <div ref={containerRef} className="docx-preview-host" />
      </div>

      {/* ─── Панель ИИ-правок (наш существующий движок editDocument) ─────────── */}
      {rendered && (
        <div style={{
          marginTop: 16, border: '1px solid var(--line-2)', borderRadius: 12,
          padding: 16, background: 'var(--surface)',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Правка через ИИ</p>
          <textarea
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            placeholder="Например: удали приложение №1 и все ссылки на него · измени сумму на 200 000 · поправь нумерацию подпунктов на 1.1, 1.2 · переделай договор с пиломатериалов на вырубку леса"
            rows={2}
            style={{
              width: '100%', padding: 10, fontSize: 13, borderRadius: 8,
              border: '1px solid var(--line-2)', background: 'var(--surface)', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => runAi('edit')}
              disabled={aiLoading || !aiInstruction.trim()}
              style={{
                height: 36, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: aiLoading ? 'default' : 'pointer', opacity: aiLoading || !aiInstruction.trim() ? 0.5 : 1,
                background: 'var(--ink)', color: '#fff', border: 'none',
              }}
            >
              ✨ Внести правку
            </button>
            <button
              onClick={() => runAi('rewrite')}
              disabled={aiLoading || !aiInstruction.trim()}
              style={{
                height: 36, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: aiLoading ? 'default' : 'pointer', opacity: aiLoading || !aiInstruction.trim() ? 0.5 : 1,
                background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-2)',
              }}
            >
              🔄 Переписать заново
            </button>
            {aiNote && <span style={{ fontSize: 12, color: aiLoading ? 'var(--ink-4)' : 'oklch(0.45 0.14 145)' }}>{aiNote}</span>}
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.5 }}>
            ИИ вычитывает весь договор (контекст), вносит правку и пересобирает документ нашим конвертером —
            предпросмотр покажет ровно то, что скачается. Это тот же движок, что на рабочем экране.
          </p>
        </div>
      )}
    </div>
  )
}
