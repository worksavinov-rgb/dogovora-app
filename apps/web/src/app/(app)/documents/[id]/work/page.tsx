'use client'

import { useState, useEffect, useRef, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'USER' | 'AI' | 'WARNING'
  content: string
  createdAt: string
}

interface Version {
  id: string
  number: number
  status: string
  content: string | null
  aiSettings: {
    protectionLevel?: number
    targetSize?: number
    customInstruction?: string
    description?: string
  }
  document?: {
    id: string
    title: string
    counterparty: { name: string }
  }
}

// ─── Константы ────────────────────────────────────────────────────────────────

const QUICK_CHIPS = [
  'Добавить неустойку',
  'Усилить конфиденциальность',
  'Уточнить сроки оплаты',
  'Добавить форс-мажор',
  'Передача прав на ИС',
]

// ─── Компонент сообщения чата ─────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: { role: string; content: string; id: string } }) {
  const isUser = msg.role === 'USER'
  const isWarning = msg.role === 'WARNING'

  if (isWarning) {
    return (
      <div className="px-[12px] py-[8px] rounded-[var(--radius-md)] text-[12px]"
        style={{ background: 'oklch(0.97 0.015 60)', border: '1px solid oklch(0.88 0.04 60)', color: 'oklch(0.55 0.08 60)' }}>
        ⚠ {msg.content}
      </div>
    )
  }

  return (
    <div className={['flex gap-[8px]', isUser ? 'justify-end' : 'justify-start'].join(' ')}>
      {!isUser && (
        <div className="shrink-0 w-[24px] h-[24px] rounded-full flex items-center justify-center mt-[2px]"
          style={{ background: 'var(--accent)' }}>
          <span className="text-[10px] text-white font-medium">✦</span>
        </div>
      )}
      <div className={[
        'max-w-[85%] px-[12px] py-[9px] rounded-[var(--radius-lg)] text-[13px] leading-[1.55]',
        isUser ? 'bg-[var(--ink)] text-[var(--bg)]' : 'bg-[var(--surface-inset)] text-[var(--ink)]',
      ].join(' ')}>
        {msg.content}
      </div>
    </div>
  )
}

// ─── Экран генерации (пока документ создаётся) ───────────────────────────────

function GeneratingScreen({ progress, docTitle }: { progress: number; docTitle: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-[24px]"
      style={{ background: 'var(--bg-soft)' }}>
      <div className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <span className="text-[22px]" style={{ animation: 'spin 2s linear infinite', display: 'inline-block' }}>✦</span>
      </div>
      <div className="text-center">
        <p className="text-[15px] font-medium text-[var(--ink)] mb-[6px]"
          style={{ fontFamily: 'var(--font-serif)' }}>
          Генерирую документ…
        </p>
        <p className="text-[12px] text-[var(--ink-4)]">{docTitle}</p>
      </div>
      {/* Прогресс-бар */}
      <div className="w-[240px] h-[3px] rounded-full bg-[var(--line)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, background: 'var(--accent)' }}
        />
      </div>
      <p className="text-[11px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>
        {progress}%
      </p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [version, setVersion] = useState<Version | null>(null)
  const [loading, setLoading] = useState(true)
  const [docContent, setDocContent] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState(0)
  const [docView, setDocView] = useState<'clean' | 'changes' | 'diff'>('clean')

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('') // чат-пузырь
  const [streamingDoc, setStreamingDoc] = useState<string | null>(null) // обновление документа
  const [saving, setSaving] = useState(false)
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false) // есть несохранённые ИИ-правки

  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Polling статуса задачи генерации
  const pollJob = useCallback(async (jobId: string, versionId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (!res.ok) return

      const job = await res.json()
      setGenProgress(job.progress ?? 0)

      if (job.state === 'completed') {
        // Загружаем свежий контент версии
        const vRes = await fetch(`/api/documents/${id}`)
        if (vRes.ok) {
          const doc = await vRes.json()
          const ver = doc.versions.find((v: Version) => v.id === versionId)
          if (ver?.content) {
            setDocContent(ver.content)
            setVersion((prev) => prev ? { ...prev, content: ver.content, status: 'DRAFT' } : prev)
          }
        }
        setGenerating(false)
        setGenProgress(100)
      } else if (job.state === 'failed') {
        setGenerating(false)
        setDocContent('Ошибка генерации. Попробуйте создать документ заново.')
      } else {
        // Продолжаем polling через 1.5с
        pollTimerRef.current = setTimeout(() => pollJob(jobId, versionId), 1500)
      }
    } catch {
      pollTimerRef.current = setTimeout(() => pollJob(jobId, versionId), 2000)
    }
  }, [id])

  // Загрузка версии при монтировании
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const versionId = searchParams.get('version')

    fetch(`/api/documents/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(async (doc) => {
        const ver: Version = versionId
          ? doc.versions.find((v: Version) => v.id === versionId)
          : doc.versions[0]

        if (!ver) throw new Error('no version')

        const versionWithDoc = {
          ...ver,
          document: { id: doc.id, title: doc.title, counterparty: doc.counterparty },
        }
        setVersion(versionWithDoc)

        // Загружаем историю чата
        fetch(`/api/versions/${ver.id}/chat`)
          .then((r) => r.ok ? r.json() : [])
          .then(setMessages)
          .catch(() => {})

        // Если контент уже есть — показываем сразу
        if (ver.content) {
          setDocContent(ver.content)
        } else {
          // Запускаем генерацию через BullMQ
          setGenerating(true)
          setGenProgress(0)
          const genRes = await fetch(`/api/versions/${ver.id}/generate`, { method: 'POST' })
          if (genRes.ok) {
            const { jobId, status } = await genRes.json()
            if (status === 'already_generated') {
              setGenerating(false)
            } else if (jobId) {
              pollJob(jobId, ver.id)
            }
          } else {
            setGenerating(false)
            setDocContent('Не удалось запустить генерацию.')
          }
        }
      })
      .catch(() => router.push('/documents'))
      .finally(() => setLoading(false))

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [id])

  // Автоскролл чата
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Отправка сообщения в чат (режим edit — ИИ меняет документ)
  async function sendMessage() {
    if (!input.trim() || streaming || !version) return

    const userText = input.trim()
    setInput('')
    setStreaming(true)
    setStreamingContent('')
    setStreamingDoc(null)

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'USER',
      content: userText,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    try {
      const response = await fetch(`/api/versions/${version.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userText, mode: 'edit' }),
      })

      if (!response.ok || !response.body) throw new Error('Failed')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let aiChatText = ''
      let aiDocText = ''
      let docPhase = false // сначала стримим doc, потом chat

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)

        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)

            if (parsed.type === 'doc' && parsed.chunk) {
              // Документ начал обновляться
              if (!docPhase) {
                docPhase = true
                setStreamingDoc('') // триггер для показа документа
              }
              aiDocText += parsed.chunk
              setStreamingDoc(aiDocText)
            }

            if (parsed.type === 'chat' && parsed.chunk) {
              aiChatText += parsed.chunk
              setStreamingContent(aiChatText)
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // Применяем обновлённый документ
      if (aiDocText.trim()) {
        setDocContent(aiDocText.trim())
        setHasUnsavedEdits(true)
        // Обновляем мобильный таб чтобы пользователь видел документ
      }

      // Финализируем чат-сообщение
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'AI',
          content: aiChatText.trim() || 'Документ обновлён.',
          createdAt: new Date().toISOString(),
        },
      ])
      setStreamingContent('')
      setStreamingDoc(null)
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'WARNING', content: 'Ошибка соединения. Попробуйте ещё раз.', createdAt: new Date().toISOString() },
      ])
    } finally {
      setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  async function saveAsNewVersion() {
    if (!version || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/documents/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiSettings: {
            protectionLevel: version.aiSettings?.protectionLevel ?? 70,
            targetSize: version.aiSettings?.targetSize ?? 8000,
            customInstruction: version.aiSettings?.customInstruction ?? '',
            description: 'Сохранено из рабочего экрана',
          },
          status: 'IN_PROGRESS',
          // Передаём текущий (отредактированный) текст документа
          content: docContent ?? undefined,
        }),
      })
      if (res.ok) {
        setHasUnsavedEdits(false)
        router.push(`/documents/${id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (!version) return null

  const protectionLevel = version.aiSettings?.protectionLevel ?? 70
  const docTitle = version.document?.title ?? 'Документ'
  const charCount = docContent?.length ?? 0
  const [mobileTab, setMobileTab] = useState<'doc' | 'chat'>('doc')

  return (
    <div className="flex flex-col md:flex-row" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

      {/* Мобильный переключатель Документ ↔ Чат */}
      <div className="md:hidden shrink-0 flex" style={{ borderBottom: '1px solid var(--line)' }}>
        {([
          { key: 'doc', label: 'Документ' },
          { key: 'chat', label: 'ИИ-чат' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMobileTab(tab.key)}
            className="flex-1 h-[40px] text-[13px] font-medium transition-colors cursor-pointer"
            style={{
              background: mobileTab === tab.key ? 'var(--ink)' : 'var(--bg)',
              color: mobileTab === tab.key ? 'var(--bg)' : 'var(--ink-3)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Левая колонка — документ ─────────────────────────────────── */}
      <div className={['flex-1 flex flex-col min-w-0', mobileTab === 'chat' ? 'hidden md:flex' : 'flex'].join(' ')} style={{ borderRight: '1px solid var(--line)' }}>

        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-[12px] px-[24px]"
          style={{ height: 48, borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
          <button
            onClick={() => router.push(`/documents/${id}`)}
            className="flex items-center gap-[6px] text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            {docTitle}
          </button>
          <span style={{ color: 'var(--line)' }}>·</span>
          <span className="text-[11px] font-medium text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-mono)' }}>
            v.{version.number}
          </span>
          {charCount > 0 && (
            <>
              <span style={{ color: 'var(--line)' }}>·</span>
              <span className="text-[12px] text-[var(--ink-4)]">{charCount.toLocaleString('ru')} знаков</span>
            </>
          )}
          <div className="flex-1" />

          {/* Переключатель режима */}
          {!generating && (
            <div className="flex rounded-[var(--radius-md)] overflow-hidden" style={{ border: '1px solid var(--line)' }}>
              {([
                { key: 'clean', label: 'Чистовик' },
                { key: 'changes', label: 'С правками' },
                { key: 'diff', label: 'Только diff' },
              ] as const).map((tab) => (
                <button key={tab.key} onClick={() => setDocView(tab.key)}
                  className={['px-[10px] h-[28px] text-[11px] font-medium transition-colors cursor-pointer',
                    docView === tab.key ? 'bg-[var(--ink)] text-[var(--bg)]' : 'bg-[var(--bg)] text-[var(--ink-3)] hover:text-[var(--ink)]',
                  ].join(' ')}>
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Тело документа */}
        {generating ? (
          <GeneratingScreen progress={genProgress} docTitle={docTitle} />
        ) : (
          <div className="flex-1 overflow-y-auto relative" style={{ background: 'var(--bg-soft)', padding: '32px 40px' }}>
            {/* Индикатор обновления документа ИИ */}
            {streamingDoc !== null && (
              <div
                className="absolute top-[16px] left-1/2 -translate-x-1/2 z-10 flex items-center gap-[8px] px-[14px] py-[7px] rounded-full shadow-md"
                style={{ background: 'var(--ink)', color: 'var(--bg)' }}
              >
                <div className="w-[10px] h-[10px] rounded-full border-2 border-white/30 border-t-white animate-spin" />
                <span className="text-[12px] font-medium">ИИ обновляет документ…</span>
              </div>
            )}

            <div className="mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm"
              style={{ maxWidth: 720, padding: '48px 56px', minHeight: 600 }}>

              {/* Показываем streamingDoc во время обновления, иначе docContent */}
              {(streamingDoc !== null ? streamingDoc : docContent) ? (
                <pre
                  className="whitespace-pre-wrap text-[14px] leading-[1.75]"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    letterSpacing: '0.01em',
                    color: streamingDoc !== null ? 'var(--ink-3)' : 'var(--ink)',
                    transition: 'color 0.3s',
                  }}
                >
                  {streamingDoc !== null ? streamingDoc : docContent}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] gap-[12px]">
                  <p className="text-[14px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-serif)' }}>
                    Документ пуст
                  </p>
                  <p className="text-[12px] text-[var(--ink-4)]">Попросите ИИ создать или отредактировать договор</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom action bar */}
        <div className="shrink-0 flex items-center gap-[8px] px-[24px]"
          style={{ height: 56, borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
          {hasUnsavedEdits && (
            <span className="text-[11px] text-[var(--ink-4)] flex items-center gap-[5px]">
              <span className="w-[6px] h-[6px] rounded-full bg-[oklch(0.65_0.1_60)]" />
              Есть несохранённые правки
            </span>
          )}
          <button
            onClick={saveAsNewVersion}
            disabled={saving || generating}
            className="h-[36px] px-[16px] rounded-[var(--radius-md)] text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            style={{
              background: hasUnsavedEdits ? 'oklch(0.42 0.06 260)' : 'var(--ink)',
              color: 'var(--bg)',
            }}
          >
            {saving ? 'Сохраняю…' : `Сохранить как v.${version.number + 1}`}
          </button>
          <button className="h-[36px] px-[16px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            Скачать черновик
          </button>
          <div className="flex-1" />
          <button
            onClick={() => router.push(`/documents/${id}/check?version=${version.id}`)}
            className="h-[36px] px-[14px] rounded-[var(--radius-md)] text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[6px]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Проверить риски
          </button>
        </div>
      </div>

      {/* ── Правая колонка — ИИ-чат (420px фиксированная) ───────────── */}
      <div className={['shrink-0 flex flex-col', mobileTab === 'doc' ? 'hidden md:flex' : 'flex'].join(' ')} style={{ width: '100%', maxWidth: 420, background: 'var(--bg)' }}>

        {/* Хедер чата */}
        <div className="shrink-0 flex items-center justify-between px-[20px]"
          style={{ height: 48, borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-[8px]">
            <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center"
              style={{ background: 'var(--accent)' }}>
              <span className="text-[9px] text-white">✦</span>
            </div>
            <span className="text-[13px] font-medium text-[var(--ink)]">ИИ-помощник</span>
          </div>
          <div className="flex items-center gap-[12px]">
            <div className="flex items-center gap-[5px]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span className="text-[11px] font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                {protectionLevel}%
              </span>
            </div>
            <button onClick={() => router.push(`/documents/${id}/compare`)}
              className="text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer">
              ⇄ версии
            </button>
          </div>
        </div>

        {/* История сообщений */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px 16px 8px' }}>
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full gap-[12px] text-center">
              <div className="w-[40px] h-[40px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
                <span className="text-[16px]">✦</span>
              </div>
              <div>
                <p className="text-[14px] font-medium text-[var(--ink)] mb-[4px]">Готов помочь с договором</p>
                <p className="text-[12px] text-[var(--ink-4)] max-w-[240px]">
                  Попросите внести правку, усилить пункт или переформулировать условие
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-[12px]">
            {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}

            {streaming && streamingContent && (
              <ChatBubble msg={{ id: 'streaming', role: 'AI', content: streamingContent }} />
            )}
            {streaming && !streamingContent && (
              <div className="flex gap-[8px] items-start">
                <div className="shrink-0 w-[24px] h-[24px] rounded-full flex items-center justify-center mt-[2px]"
                  style={{ background: 'var(--accent)' }}>
                  <span className="text-[10px] text-white">✦</span>
                </div>
                <div className="px-[12px] py-[9px] rounded-[var(--radius-lg)] bg-[var(--surface-inset)]">
                  <div className="flex gap-[4px] items-center">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-[5px] h-[5px] rounded-full bg-[var(--ink-4)]"
                        style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Быстрые чипы */}
        <div className="shrink-0 px-[12px] pb-[8px] flex gap-[6px] flex-wrap">
          {QUICK_CHIPS.map((chip) => (
            <button key={chip} onClick={() => { setInput(chip); textareaRef.current?.focus() }}
              className="px-[10px] h-[26px] rounded-full text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer whitespace-nowrap">
              {chip}
            </button>
          ))}
        </div>

        {/* Поле ввода */}
        <div className="shrink-0 px-[12px] pb-[12px]">
          <div className="flex items-end gap-[8px] rounded-[var(--radius-lg)] bg-[var(--surface-inset)]"
            style={{ padding: '10px 10px 10px 12px' }}>
            <button className="shrink-0 mb-[1px] flex items-center gap-[4px] hover:opacity-70 transition-opacity cursor-pointer"
              style={{ color: 'var(--accent)' }} title={`Уровень защиты: ${protectionLevel}%`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span className="text-[11px] font-medium" style={{ fontFamily: 'var(--font-mono)' }}>{protectionLevel}</span>
            </button>

            <textarea ref={textareaRef} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Попросите внести правку…"
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-4)] outline-none leading-[1.5] disabled:opacity-50"
              style={{ maxHeight: 120, overflowY: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
            />

            <button onClick={sendMessage} disabled={!input.trim() || streaming}
              className="shrink-0 w-[32px] h-[32px] rounded-[var(--radius-md)] bg-[var(--ink)] text-[var(--bg)] flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
