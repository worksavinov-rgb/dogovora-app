'use client'

import { useState, useEffect, useRef, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { calcVersionPrice } from '@/lib/pricing'

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
  formattingApplied?: boolean | null
  aiSettings: {
    protectionLevel?: number
    targetSize?: number
    customInstruction?: string
    description?: string
    base?: string
  }
  document?: {
    id: string
    title: string
    type: string
    counterparty: { name: string }
  }
  purchase?: { id: string } | null
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

// ─── Красивый рендер текста договора ─────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1] !== undefined) parts.push(<strong key={key++}>{match[1]}</strong>)
    else if (match[2] !== undefined) parts.push(<em key={key++}>{match[2]}</em>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function DocumentRenderer({ text, canCopy }: { text: string; canCopy: boolean }) {
  const lines = text.split('\n')

  const isAllCaps = (s: string) =>
    s.length > 3 && s === s.toUpperCase() && /[А-ЯA-Z]/.test(s)

  const clauseLevel = (s: string): number => {
    const m = s.match(/^(\d+(?:\.\d+)*)\.?\s/)
    if (!m) return -1
    return m[1].split('.').length - 1
  }

  // Убираем markdown-звёздочки из строки для определения структуры
  const clean = (s: string) => s.replace(/\*\*/g, '').replace(/\*/g, '').trim()

  return (
    <div
      style={{ userSelect: canCopy ? 'text' : 'none' }}
      onCopy={!canCopy ? (e) => e.preventDefault() : undefined}
    >
      {lines.map((line, i) => {
        const t = line.trim()
        const c = clean(t)

        if (!c) return <div key={i} className="h-[6px]" />

        if (isAllCaps(c)) {
          return (
            <p key={i} className="text-[13px] font-bold text-[var(--ink)] uppercase tracking-[0.06em] mt-[24px] mb-[8px]">
              {renderInline(t)}
            </p>
          )
        }

        const level = clauseLevel(c)

        if (level === 0) {
          return (
            <p key={i} className="text-[14px] font-semibold text-[var(--ink)] leading-[1.6] mt-[18px] mb-[5px]">
              {renderInline(t)}
            </p>
          )
        }

        if (level > 0) {
          return (
            <p key={i} className="text-[13.5px] text-[var(--ink)] leading-[1.75] mb-[4px]"
              style={{ paddingLeft: 20 * level }}>
              {renderInline(t)}
            </p>
          )
        }

        return (
          <p key={i} className="text-[14px] text-[var(--ink)] leading-[1.8] mb-[5px]">
            {renderInline(t)}
          </p>
        )
      })}
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
  const [docView, setDocView] = useState<'text' | 'formatted'>('formatted')
  const [mobileTab, setMobileTab] = useState<'doc' | 'chat'>('doc')

  // A.5: HTML из DOCX (через mammoth) для режима "Вид"
  const [docHtml, setDocHtml] = useState<string | null>(null)
  const [loadingHtml, setLoadingHtml] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('') // чат-пузырь
  const [streamingDoc, setStreamingDoc] = useState<string | null>(null) // обновление документа
  const [saving, setSaving] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false) // есть правки, не зафиксированные как версия
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle') // статус автосохранения
  const [downloading, setDownloading] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [purchased, setPurchased] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Автосохранение рабочей копии (черновика)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRevisionRef = useRef(0)
  const baseVersionIdRef = useRef<string | null>(null)
  const isLatestRef = useRef(true) // автосейв только для последней (редактируемой) версии
  const dirtyRef = useRef(false)   // есть несохранённый «хвост» (для beforeunload)
  const lastSavedContentRef = useRef<string | null>(null)

  // Polling статуса задачи генерации
  const pollJob = useCallback(async function runPoll(jobId: string, versionId: string) {
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
        pollTimerRef.current = setTimeout(() => {
          void runPoll(jobId, versionId)
        }, 1500)
      }
    } catch {
      pollTimerRef.current = setTimeout(() => {
        void runPoll(jobId, versionId)
      }, 2000)
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
          document: { id: doc.id, title: doc.title, type: doc.type, counterparty: doc.counterparty },
        }
        setVersion(versionWithDoc)

        // Автосейв включаем только для последней (редактируемой) версии
        const isLatest = ver.id === doc.versions[0]?.id
        isLatestRef.current = isLatest
        baseVersionIdRef.current = ver.id
        lastSavedContentRef.current = ver.content ?? null

        // Загружаем историю чата
        fetch(`/api/versions/${ver.id}/chat`)
          .then((r) => r.ok ? r.json() : [])
          .then(setMessages)
          .catch(() => {})

        // Загружаем рабочую копию (черновик с несохранёнными правками прошлой сессии)
        let draftContent: string | null = null
        if (isLatest) {
          try {
            const draftRes = await fetch(`/api/documents/${id}/draft`)
            if (draftRes.ok) {
              const draft = await draftRes.json() as { content: string; revision: number } | null
              if (draft && typeof draft.content === 'string') {
                draftRevisionRef.current = draft.revision
                draftContent = draft.content
              }
            }
          } catch { /* черновик не критичен — продолжаем с версией */ }
        }

        if (draftContent !== null && draftContent !== ver.content) {
          // Есть несохранённые правки — подтягиваем рабочую копию
          setDocContent(draftContent)
          lastSavedContentRef.current = draftContent
          setHasUnsavedEdits(true)
        } else if (ver.content) {
          // Контент версии уже есть — показываем сразу
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
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [id, pollJob, router])

  // Лёгкий предохранитель: предупреждаем при уходе, только если автосейв не долетел
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ─── Автосохранение рабочей копии (черновика) ───────────────────────────────
  async function saveDraft(content: string) {
    try {
      setSaveStatus('saving')
      const res = await fetch(`/api/documents/${id}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          baseVersionId: baseVersionIdRef.current ?? undefined,
          revision: draftRevisionRef.current,
        }),
      })
      if (!res.ok) { setSaveStatus('error'); return }
      const data = await res.json() as { revision: number }
      draftRevisionRef.current = data.revision
      lastSavedContentRef.current = content
      dirtyRef.current = false
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  function scheduleAutosave(content: string) {
    if (content === lastSavedContentRef.current) return
    dirtyRef.current = true // включает beforeunload-предохранитель
    // Старые версии не сохраняем в draft (он один на документ и привязан к последней).
    // Зафиксировать правки можно только через «Сохранить» → создаст новую версию.
    if (!isLatestRef.current) return
    setSaveStatus('saving')
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => { void saveDraft(content) }, 2000)
  }

  // Автоскролл чата
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    if (!statusDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusDropdownOpen])

  // A.5: загружаем DOCX→HTML когда форматирование применено и нет несохранённых правок
  useEffect(() => {
    if (!version?.formattingApplied || !version?.id) return
    if (hasUnsavedEdits) return // есть несохранённые правки — показываем DocumentRenderer
    if (docHtml) return // уже загружен
    setLoadingHtml(true)
    fetch(`/api/versions/${version.id}/formatted-html`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { html: string } | null) => {
        if (data?.html) setDocHtml(data.html)
      })
      .catch(() => {})
      .finally(() => setLoadingHtml(false))
  }, [version?.id, version?.formattingApplied, hasUnsavedEdits, docHtml])

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
        body: JSON.stringify({
          content: userText,
          mode: 'edit',
          currentDocument: streamingDoc ?? docContent ?? '',
        }),
      })

      if (!response.ok || !response.body) {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'WARNING', content: 'Ошибка соединения. Попробуйте ещё раз.', createdAt: new Date().toISOString() },
        ])
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let aiChatText = ''
      let aiDocText = ''
      let docPhase = false // сначала стримим doc, потом chat
      let sseBuffer = ''
      let doneSignal = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })

        let delimiterIndex = sseBuffer.indexOf('\n\n')
        while (delimiterIndex !== -1) {
          const eventChunk = sseBuffer.slice(0, delimiterIndex)
          sseBuffer = sseBuffer.slice(delimiterIndex + 2)
          delimiterIndex = sseBuffer.indexOf('\n\n')

          const dataLines = eventChunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())

          if (dataLines.length === 0) continue
          const data = dataLines.join('\n')

          if (data === '[DONE]') {
            doneSignal = true
            break
          }

          try {
            const parsed = JSON.parse(data) as { type?: string; chunk?: string }

            if (parsed.type === 'doc' && parsed.chunk) {
              if (!docPhase) {
                docPhase = true
                setStreamingDoc('')
              }
              aiDocText += parsed.chunk
              setStreamingDoc(aiDocText)
            }

            if (parsed.type === 'chat' && parsed.chunk) {
              aiChatText += parsed.chunk
              setStreamingContent(aiChatText)
            }
          } catch {
            // Ignore partial/malformed event payloads
          }
        }

        if (doneSignal) break
      }

      // Применяем обновлённый документ
      if (aiDocText.trim()) {
        const updatedDoc = aiDocText.trim()
        setDocContent(updatedDoc)
        setHasUnsavedEdits(true)
        scheduleAutosave(updatedDoc) // автосохранение рабочей копии
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
    setSaveConfirmOpen(false)
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
        const newVersion = await res.json() as { id: string }
        setHasUnsavedEdits(false)
        // Правки зафиксированы как версия — рабочая копия больше не нужна
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
        dirtyRef.current = false
        draftRevisionRef.current = 0
        await fetch(`/api/documents/${id}/draft`, { method: 'DELETE' }).catch(() => {})
        // A.6: фоновое применение форматирования к новой версии (не блокирует переход)
        fetch(`/api/versions/${newVersion.id}/apply-formatting`, { method: 'POST' }).catch(() => {})
        router.push(`/documents/${id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function purchaseVersion() {
    if (!version || purchasing) return
    setPurchasing(true)
    try {
      const res = await fetch(`/api/versions/${version.id}/purchase`, { method: 'POST' })
      if (res.ok) {
        setPurchased(true)
        setVersion((prev) => prev ? { ...prev, purchase: { id: 'done' }, status: 'PAID' } : prev)
      }
    } finally {
      setPurchasing(false)
    }
  }

  async function changeStatus(newStatus: string) {
    if (!version || statusChanging) return
    setStatusChanging(true)
    setStatusDropdownOpen(false)
    try {
      const res = await fetch(`/api/versions/${version.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setVersion((prev) => prev ? { ...prev, status: newStatus } : prev)
      }
    } finally {
      setStatusChanging(false)
    }
  }

  async function downloadDocx() {
    if (!version || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/versions/${version.id}/download`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename\*=UTF-8''(.+)/)
      a.download = filenameMatch ? decodeURIComponent(filenameMatch[1]) : `договор_v${version.number}.docx`
      a.href = url
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────

  // Отрицательные margins компенсируют padding AppLayout (24px со всех сторон),
  // чтобы рабочий экран занял весь доступный viewport без полос прокрутки.
  const fullBleedStyle: React.CSSProperties = {
    margin: '-24px',
    height: 'calc(100vh - 56px)',
    overflow: 'hidden',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={fullBleedStyle}>
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (!version) return null

  const protectionLevel = version.aiSettings?.protectionLevel ?? 70
  const docTitle = version.document?.title ?? 'Документ'
  const charCount = docContent?.length ?? 0
  const wordCount = docContent ? docContent.trim().split(/\s+/).filter(Boolean).length : 0
  const isPurchased = Boolean(version.purchase) || purchased
  const docType = version.document?.type ?? 'CONTRACT'
  const versionPrice = calcVersionPrice(docType, charCount)

  const STATUS_OPTIONS = [
    { value: 'DRAFT', label: 'Черновик' },
    { value: 'IN_PROGRESS', label: 'В работе' },
    { value: 'REVIEW', label: 'На проверке' },
    { value: 'APPROVED', label: 'Утверждено' },
    { value: 'PAID', label: 'Оплачено' },
  ]
  const currentStatusLabel = STATUS_OPTIONS.find(s => s.value === version.status)?.label ?? version.status
  return (
    <>
    <style>{`
      @media print {
        body > * { display: none !important; }
        .print-doc { display: block !important; position: fixed; top: 0; left: 0; width: 100%; }
      }
    `}</style>
    <div className="flex flex-col md:flex-row" style={fullBleedStyle}>

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
        <div className="shrink-0 flex items-center gap-[6px] px-[12px]"
          style={{ height: 52, borderBottom: '1px solid var(--line)', background: 'var(--bg)', flexWrap: 'nowrap', minWidth: 0 }}>

          {/* Навигация назад + мета */}
          <button
            onClick={() => router.push(`/documents/${id}`)}
            className="shrink-0 flex items-center gap-[5px] h-[30px] px-[10px] rounded-[var(--radius-md)] text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer border border-[var(--line-2)]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span className="hidden md:inline">Назад</span>
          </button>

          <span className="shrink-0 text-[12px] text-[var(--ink-2)]" style={{ fontFamily: 'var(--font-mono)' }}>
            v.{version.number}{charCount > 0 ? ` · ${charCount.toLocaleString('ru')} зн. / ${wordCount.toLocaleString('ru')} сл.` : ''}
          </span>
          {saveStatus === 'saving' && (
            <span className="hidden md:flex shrink-0 items-center gap-[4px] text-[11px] text-[var(--ink-4)]">
              <span className="w-[10px] h-[10px] rounded-full border-2 border-[var(--line)] border-t-[var(--ink-3)] animate-spin" />
              Сохранение…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="hidden md:flex shrink-0 items-center gap-[4px] text-[11px] text-[var(--ink-4)]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Сохранено
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="hidden md:flex shrink-0 items-center gap-[4px] text-[11px] text-[var(--danger)]">
              <span className="w-[5px] h-[5px] rounded-full bg-[var(--danger)]" />
              Ошибка сохранения
            </span>
          )}
          {saveStatus === 'idle' && hasUnsavedEdits && (
            <span className="hidden md:flex shrink-0 items-center gap-[4px] text-[11px] text-[oklch(0.55_0.08_60)]">
              <span className="w-[5px] h-[5px] rounded-full bg-[oklch(0.65_0.1_60)]" />
              Не зафиксировано
            </span>
          )}

          <div className="flex-1 min-w-0" />

          {/* ── ИИ-функции ── */}
          <div className="hidden md:flex items-center gap-[4px]">
            {/* Вид / Текст */}
            {!generating && (
              <div className="flex shrink-0 rounded-[var(--radius-md)] overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                {([
                  { key: 'formatted' as const, label: 'Вид' },
                  { key: 'text' as const, label: 'Текст' },
                ]).map((tab) => (
                  <button key={tab.key} onClick={() => setDocView(tab.key)}
                    className={['px-[8px] h-[26px] text-[11px] font-medium transition-colors cursor-pointer',
                      docView === tab.key ? 'bg-[var(--ink)] text-[var(--bg)]' : 'bg-[var(--bg)] text-[var(--ink-3)] hover:text-[var(--ink)]',
                    ].join(' ')}>
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

          </div>

          {/* Разделитель */}
          <div className="hidden md:block w-px h-[24px] bg-[var(--line)] mx-[4px] shrink-0" />

          {/* ── Документ-функции ── */}
          <div className="flex items-center gap-[4px]">

            {/* Сохранить как новую версию */}
            <div className="relative">
              <button
                onClick={() => setSaveConfirmOpen(v => !v)}
                disabled={saving || generating}
                className="shrink-0 h-[30px] px-[10px] rounded-[var(--radius-md)] text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-[5px] border"
                style={{
                  background: hasUnsavedEdits ? 'var(--ink)' : 'transparent',
                  color: hasUnsavedEdits ? 'var(--bg)' : 'var(--ink)',
                  borderColor: hasUnsavedEdits ? 'var(--ink)' : 'var(--line-2)',
                }}
              >
                {saving ? 'Сохраняю…' : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    <span className="hidden md:inline">Сохранить</span>
                  </>
                )}
              </button>

              {/* Поп-ап подтверждения сохранения */}
              {saveConfirmOpen && (
                <div
                  className="absolute left-0 top-[38px] z-50 rounded-[var(--radius-lg)] w-[260px]"
                  style={{ background: 'white', border: '1px solid var(--line-2)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '16px' }}
                >
                  <p className="text-[12px] font-medium text-[var(--ink)] mb-[4px]">
                    Сохранить как версию v.{version.number + 1}?
                  </p>
                  <p className="text-[11px] text-[var(--ink-4)] mb-[14px] leading-[1.5]">
                    Текущий текст будет сохранён как новая версия. Предыдущая v.{version.number} останется в истории.
                  </p>
                  <div className="flex gap-[6px]">
                    <button
                      onClick={() => setSaveConfirmOpen(false)}
                      className="flex-1 h-[30px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--surface-inset)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={saveAsNewVersion}
                      className="flex-1 h-[30px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Сохранить v.{version.number + 1}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Статус */}
            {!generating && (
              <div ref={statusDropdownRef} className="relative hidden md:block">
                <button
                  onClick={() => setStatusDropdownOpen(v => !v)}
                  disabled={statusChanging || isPurchased}
                  className="h-[30px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-[4px]"
                  style={{ background: 'transparent', borderColor: 'var(--line-2)', color: 'var(--ink-3)' }}
                >
                  {currentStatusLabel}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {statusDropdownOpen && (
                  <div className="absolute right-0 top-[34px] z-50 rounded-[var(--radius-md)] overflow-hidden min-w-[150px]"
                    style={{ background: 'white', border: '1px solid var(--line-2)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                    {STATUS_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => changeStatus(opt.value)}
                        className="w-full text-left px-[12px] py-[8px] text-[12px] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer"
                        style={{ color: opt.value === version.status ? 'var(--ink)' : 'var(--ink-3)', fontWeight: opt.value === version.status ? 600 : 400 }}>
                        {opt.label}
                        {opt.value === version.status && ' ✓'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Купить */}
            {!isPurchased && !generating && docContent && (
              <button
                onClick={purchaseVersion}
                disabled={purchasing}
                className="shrink-0 h-[30px] px-[10px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 flex items-center gap-[5px]"
              >
                {purchasing ? 'Покупаю…' : `Купить · ${versionPrice} ₽`}
              </button>
            )}

            {/* Скачать DOCX */}
            {isPurchased ? (
              <button
                onClick={downloadDocx}
                disabled={downloading || generating}
                className="shrink-0 h-[30px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-[4px]"
              >
                {downloading ? (
                  <div className="w-[8px] h-[8px] rounded-full border border-[var(--ink-3)] border-t-transparent animate-spin" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                )}
                <span className="hidden md:inline">{downloading ? 'Скачиваю…' : 'Скачать'}</span>
              </button>
            ) : (
              <button disabled title="Купите версию, чтобы скачать"
                className="shrink-0 h-[30px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-4)] cursor-not-allowed opacity-40 hidden md:flex items-center gap-[4px]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                <span className="hidden md:inline">Скачать</span>
              </button>
            )}

            {/* Печать */}
            <button
              onClick={() => isPurchased && window.print()}
              disabled={!isPurchased || generating}
              className="shrink-0 h-[30px] w-[30px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              title={isPurchased ? 'Печать' : 'Купите версию, чтобы распечатать'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            </button>
          </div>
        </div>

        {/* Тело документа */}
        {generating ? (
          <GeneratingScreen progress={genProgress} docTitle={docTitle} />
        ) : (
          <div className="flex-1 overflow-y-auto relative" style={{ background: 'var(--bg-soft)', padding: '32px 40px 48px' }}>
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

            <div
              className="mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm relative overflow-hidden"
              style={{ maxWidth: 720, padding: '48px 56px', minHeight: 600 }}
            >
              {/* Ватермарк для неоплаченных версий */}
              {!isPurchased && docContent && (
                <div
                  className="absolute inset-0 pointer-events-none select-none z-[1]"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='IBM Plex Sans, sans-serif' font-size='22' font-weight='600' fill='rgba(0,0,0,0.06)' transform='rotate(-35 150 100)'%3EЧЕРНОВИК%3C/text%3E%3C/svg%3E")`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: '300px 200px',
                  }}
                />
              )}

              {/* Содержимое: streamingDoc во время обновления, иначе docContent */}
              {(() => {
                const displayText = streamingDoc !== null ? streamingDoc : docContent
                const isUpdating = streamingDoc !== null

                if (!displayText) {
                  return (
                    <div className="flex flex-col items-center justify-center h-[400px] gap-[12px] relative z-[2]">
                      <p className="text-[14px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-serif)' }}>
                        Документ пуст
                      </p>
                      <p className="text-[12px] text-[var(--ink-4)]">Попросите ИИ создать или отредактировать договор</p>
                    </div>
                  )
                }

                // A.5: показываем DOCX HTML если: форматирование применено + нет live-стриминга + не в текстовом режиме
                const showDocxHtml = docView === 'formatted' && !isUpdating && docHtml && !hasUnsavedEdits

                return (
                  <div className="relative z-[2]" style={{ opacity: isUpdating ? 0.6 : 1, transition: 'opacity 0.3s' }}>
                    {docView === 'formatted' && loadingHtml && !docHtml ? (
                      // Индикатор загрузки HTML из DOCX
                      <div className="flex items-center justify-center py-[40px] gap-[8px] text-[var(--ink-4)]">
                        <div className="w-[14px] h-[14px] rounded-full border-2 border-[var(--line)] border-t-[var(--ink-3)] animate-spin" />
                        <span className="text-[12px]">Загружаю форматированный вид…</span>
                      </div>
                    ) : showDocxHtml ? (
                      // DOCX → HTML через mammoth (точное форматирование: таблицы, жирный, курсив)
                      <div
                        className="docx-rendered"
                        style={{ userSelect: isPurchased ? 'text' : 'none' }}
                        onCopy={!isPurchased ? (e) => e.preventDefault() : undefined}
                        dangerouslySetInnerHTML={{ __html: docHtml }}
                      />
                    ) : docView === 'formatted' ? (
                      // Режим "Вид" без DOCX: структурированный рендер из plain text
                      <DocumentRenderer text={displayText} canCopy={isPurchased} />
                    ) : (
                      // Режим "Текст": pre-форматированный
                      <pre
                        className="whitespace-pre-wrap text-[14px] leading-[1.75]"
                        style={{
                          fontFamily: 'var(--font-serif)',
                          letterSpacing: '0.01em',
                          color: 'var(--ink)',
                          userSelect: isPurchased ? 'text' : 'none',
                        }}
                        onCopy={!isPurchased ? (e) => e.preventDefault() : undefined}
                      >
                        {displayText}
                      </pre>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        )}

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
            <span className="text-[13px] font-medium text-[var(--ink)]">Чат с ИИ</span>
          </div>
          <div className="flex items-center gap-[4px]">
            {docContent && !generating && (
              <button
                onClick={() => { setInput('Проверь этот договор: укажи 3-5 конкретных слабых места и дай рекомендации по улучшению каждого пункта.'); textareaRef.current?.focus() }}
                className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--accent)' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Анализ
              </button>
            )}
            {!generating && (
              <button
                onClick={() => router.push(`/documents/${id}/check?version=${version.id}`)}
                className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                Риски
              </button>
            )}
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
    </>
  )
}
