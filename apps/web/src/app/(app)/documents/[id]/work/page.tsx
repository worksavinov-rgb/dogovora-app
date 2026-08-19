'use client'

import { useState, useEffect, useRef, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
// При 401 (истёк 15-мин access-токен) сессия прозрачно обновляется глобальным
// перехватчиком fetch (см. lib/install-fetch-auth.ts) — отдельная обёртка не нужна.
import { useAuthStore } from '@/store/auth'
import { DocumentViewer } from '@/components/document-viewer'
import { EditorToolbar } from '@/components/editor-toolbar'
import { DecorModal } from '@/components/decor-modal'
import type { Editor } from '@tiptap/react'

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
    counterparty: { id?: string; name: string }
  }
}

interface DecorState {
  preambleHtml: string | null
  requisitesHtml: string | null
  confirmed: boolean
}

interface EditQuota {
  limit: number
  used: number
  remaining: number
  packages: number
  isUploaded: boolean
  prices: { editPackage: number; rewrite: number; generate: number; uploadEditStart: number; review: number }
}

// ─── Константы ────────────────────────────────────────────────────────────────

const QUICK_CHIPS_EDIT = [
  'Добавить неустойку',
  'Усилить конфиденциальность',
  'Уточнить сроки оплаты',
  'Добавить форс-мажор',
  'Передача прав на ИС',
]

const QUICK_CHIPS_CHAT = [
  'Что означает этот пункт?',
  'Кто несёт больше рисков?',
  'Есть ли жёсткие сроки?',
  'Как расторгнуть договор?',
  'Что с оплатой?',
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
        {isUser ? msg.content : stripMarkdown(msg.content)}
      </div>
    </div>
  )
}

// ─── Экран генерации (пока документ создаётся) ───────────────────────────────
// Убирает markdown-разметку, оставляя чистый текст (используется в чате)
function stripMarkdown(s: string): string {
  return s
    .replace(/^#{1,6}\s+/gm, '')      // ## заголовки
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **жирный**
    .replace(/\*(.+?)\*/g, '$1')      // *курсив*
    .replace(/^[-*]\s+/gm, '')        // маркеры списка
    .trim()
}

// ─── Блок слоя оформления (шапка / реквизиты) ────────────────────────────────
// Часть «листа», но НЕ часть тела версии: хранится на документе, редактируется
// по клику (contentEditable), сохраняется по blur через PATCH /decor.

function DecorBlock({ html, hint, onSave }: { html: string; hint: string; onSave: (html: string) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="group relative my-[4px]">
      <div
        contentEditable={editing}
        suppressContentEditableWarning
        onClick={() => !editing && setEditing(true)}
        onBlur={(e) => { setEditing(false); onSave(e.currentTarget.innerHTML) }}
        className={[
          'doc-content rounded-[4px] transition-shadow',
          editing ? 'outline-none ring-1 ring-[var(--accent)] cursor-text' : 'cursor-pointer hover:ring-1 hover:ring-[var(--line-2)]',
        ].join(' ')}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {!editing && (
        <span className="absolute -top-[16px] right-0 hidden group-hover:block text-[10px] text-[var(--ink-4)] select-none pointer-events-none">
          {hint}
        </span>
      )}
    </div>
  )
}

// ─── Экран генерации (пока документ создаётся) ───────────────────────────────

function GenerationErrorScreen({ docTitle, onRetry }: { docTitle: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-[24px] px-6"
      style={{ background: 'var(--bg-soft)' }}>
      <div className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
        style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
        <span className="text-[22px]">⚠</span>
      </div>
      <div className="text-center max-w-[320px]">
        <p className="text-[15px] font-medium text-[var(--ink)] mb-[8px]"
          style={{ fontFamily: 'var(--font-serif)' }}>
          Не удалось сгенерировать документ
        </p>
        <p className="text-[13px] text-[var(--ink-4)] leading-relaxed mb-[6px]">{docTitle}</p>
        <p className="text-[12px] text-[var(--ink-4)] leading-relaxed">
          Возможно, сервис Догодок временно недоступен или перегружен. Это бывает — обычно помогает повторная попытка через минуту.
        </p>
      </div>
      <div className="flex flex-col gap-[10px] w-full max-w-[240px]">
        <button
          onClick={onRetry}
          className="w-full py-[10px] rounded-[8px] text-[13px] font-medium text-white"
          style={{ background: 'var(--ink)' }}
        >
          Попробовать снова
        </button>
        <p className="text-[11px] text-[var(--ink-4)] text-center">
          Если ошибка повторяется — напишите нам, разберёмся
        </p>
      </div>
    </div>
  )
}

function GeneratingScreen({ done, docTitle }: { done: boolean; docTitle: string }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (done) {
      setProgress(100)
      return
    }
    setProgress(0)
    // Плавно заполняем до 90% за ~50 сек, потом замедляемся
    const start = Date.now()
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000
      // Логистическая кривая: быстро в начале, замедляется к концу
      const p = Math.min(90, Math.round(90 * (1 - Math.exp(-elapsed / 20))))
      setProgress(p)
    }
    const interval = setInterval(tick, 300)
    return () => clearInterval(interval)
  }, [done])

  const phases = [
    { until: 20, label: 'Анализирую задачу…' },
    { until: 50, label: 'Формирую структуру…' },
    { until: 75, label: 'Прописываю условия…' },
    { until: 90, label: 'Финализирую документ…' },
    { until: 100, label: 'Готово!' },
  ]
  const phase = phases.find(p => progress <= p.until) ?? phases[phases.length - 1]

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
          {phase.label}
        </p>
        <p className="text-[12px] text-[var(--ink-4)]">{docTitle}</p>
      </div>
      {/* Прогресс-бар */}
      <div className="w-[240px] h-[3px] rounded-full bg-[var(--line)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress}%`,
            background: 'var(--accent)',
            transition: done ? 'width 0.3s ease' : 'width 0.6s ease-out',
          }}
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
  const [genError, setGenError] = useState(false)
  const genStartRef = useRef<number | null>(null)
  const genVersionIdRef = useRef<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'doc' | 'chat'>('doc')

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [chatMode, setChatMode] = useState<'edit' | 'chat'>('edit')
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('') // чат-пузырь
  const [streamingDoc, setStreamingDoc] = useState<string | null>(null) // обновление документа
  const [saving, setSaving] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [backConfirmOpen, setBackConfirmOpen] = useState(false) // предупреждение о несохранённых правках при выходе
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false) // есть правки, не зафиксированные как версия
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle') // статус автосохранения
  const [maxVersionNumber, setMaxVersionNumber] = useState<number>(1) // максимальный номер версии по документу
  const [downloading, setDownloading] = useState(false)
  const [editQuota, setEditQuota] = useState<EditQuota | null>(null) // пакет ИИ-правок документа
  const [packageNeeded, setPackageNeeded] = useState(false) // пакет исчерпан — предложить докупку
  const [buyingPackage, setBuyingPackage] = useState(false)
  const [rewriteConfirmOpen, setRewriteConfirmOpen] = useState(false) // «Переписать заново» (загруженные)
  const [rewriting, setRewriting] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)

  const [canUndo, setCanUndo] = useState(false)
  const undoStackRef = useRef<string[]>([])

  // Редактируемый предпросмотр: экземпляр TipTap (для тулбара) и ключ внешнего
  // контента — инкремент заменяет содержимое редактора (ИИ-правка, отмена).
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null)
  const [externalKey, setExternalKey] = useState(0)

  // Слой оформления: шапка/реквизиты документа + legacy-признак (блоки вклеены в тело)
  const [decor, setDecor] = useState<DecorState | null>(null)
  const [legacyInline, setLegacyInline] = useState(false)
  const [decorModalOpen, setDecorModalOpen] = useState(false)

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
    // Таймаут 5 минут
    if (genStartRef.current && Date.now() - genStartRef.current > 7 * 60 * 1000) {
      setGenerating(false)
      setGenError(true)
      return
    }

    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (!res.ok) return

      const job = await res.json()

      if (job.state === 'completed') {
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
        setGenError(true)
      } else {
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

        // Контент берём через /api/versions/:id — там применяются структурирование
        // заголовков и сборка слоя оформления. Для редактора нужен bodyContent
        // (только тело); legacy-версии (блоки вклеены) отдаются как есть.
        try {
          const vRes = await fetch(`/api/versions/${ver.id}`)
          if (vRes.ok) {
            const full = await vRes.json() as { content?: string | null; bodyContent?: string | null; legacyInline?: boolean }
            const body = full.bodyContent ?? full.content
            if (typeof body === 'string' && body) ver.content = body
            setLegacyInline(Boolean(full.legacyInline))
          }
        } catch { /* не критично — покажем контент из списка версий */ }

        const versionWithDoc = {
          ...ver,
          document: { id: doc.id, title: doc.title, type: doc.type, counterparty: doc.counterparty },
        }
        setVersion(versionWithDoc)

        // Запоминаем максимальный номер версии по всему документу
        const allVersions = doc.versions as Array<{ number: number }>
        setMaxVersionNumber(allVersions.reduce((m, v) => Math.max(m, v.number), 0))

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
          setGenError(false)
          genStartRef.current = Date.now()
          genVersionIdRef.current = ver.id
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
            setGenError(true)
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

  // Слой оформления документа
  const refreshDecor = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${id}/decor`)
      if (res.ok) setDecor(await res.json() as DecorState)
    } catch { /* не критично */ }
  }, [id])

  useEffect(() => { void refreshDecor() }, [refreshDecor])

  // Сохранение вручную отредактированного блока оформления
  async function patchDecor(patch: { preambleHtml?: string; requisitesHtml?: string }) {
    try {
      await fetch(`/api/documents/${id}/decor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await refreshDecor()
    } catch { /* не критично */ }
  }

  // Квота ИИ-правок документа (пакеты предоплатной модели)
  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${id}/edit-quota`)
      if (res.ok) {
        const q = await res.json() as EditQuota
        setEditQuota(q)
        if (q.remaining > 0) setPackageNeeded(false)
      }
    } catch { /* не критично */ }
  }, [id])

  useEffect(() => { void refreshQuota() }, [refreshQuota])

  // Докупка пакета ИИ-правок
  async function buyEditPackage() {
    if (buyingPackage) return
    setBuyingPackage(true)
    try {
      const res = await fetch(`/api/documents/${id}/edit-package`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { balance?: number; quota?: EditQuota; error?: string }
      if (res.ok) {
        if (typeof data.balance === 'number') useAuthStore.getState().setBalance(data.balance)
        setPackageNeeded(false)
        await refreshQuota()
        setMessages((prev) => [...prev, {
          id: `pkg-${Date.now()}`, role: 'WARNING' as const,
          content: 'Пакет правок куплен — можно продолжать.', createdAt: new Date().toISOString(),
        }])
      } else if (data.error) {
        setMessages((prev) => [...prev, {
          id: `pkg-err-${Date.now()}`, role: 'WARNING' as const,
          content: data.error!, createdAt: new Date().toISOString(),
        }])
      }
    } finally {
      setBuyingPackage(false)
    }
  }

  // «Переписать заново» — полная перегенерация загруженного документа (REWRITE)
  async function rewriteDocument() {
    if (rewriting) return
    setRewriteConfirmOpen(false)
    setRewriting(true)
    try {
      const res = await fetch(`/api/documents/${id}/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({})) as { versionId?: string; error?: string }
      if (!res.ok || !data.versionId) {
        setMessages((prev) => [...prev, {
          id: `rw-err-${Date.now()}`, role: 'WARNING' as const,
          content: data.error ?? 'Не удалось запустить переписку.', createdAt: new Date().toISOString(),
        }])
        return
      }
      const genRes = await fetch(`/api/versions/${data.versionId}/generate`, { method: 'POST' })
      if (genRes.status === 402) {
        const err = await genRes.json().catch(() => ({})) as { error?: string }
        setMessages((prev) => [...prev, {
          id: `rw-402-${Date.now()}`, role: 'WARNING' as const,
          content: err.error ?? 'Не хватает токенов для переписки.', createdAt: new Date().toISOString(),
        }])
        return
      }
      // Переходим на новую версию — экран сам запустит поллинг генерации
      window.location.href = `/documents/${id}/work?version=${data.versionId}`
    } finally {
      setRewriting(false)
    }
  }

  // Префилл из страницы проверки рисков: «Исправить через ИИ-чат» кладёт
  // готовое задание в sessionStorage — подставляем его в поле ввода один раз.
  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem('chatPrefill')
      if (prefill) {
        sessionStorage.removeItem('chatPrefill')
        setInput(prefill)
        setTimeout(() => textareaRef.current?.focus(), 100)
      }
    } catch { /* sessionStorage недоступен */ }
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

  // Отправка сообщения в чат
  async function sendMessage(overrideText?: string, mode: 'edit' | 'chat' | 'quick_analysis' = chatMode) {
    const userText = (overrideText ?? input).trim()
    if (!userText || streaming || generating || !version) return

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
          mode,
          currentDocument: streamingDoc ?? docContent ?? '',
        }),
      })

      if (!response.ok || !response.body) {
        // Исчерпан пакет правок / не хватает токенов / частотный лимит — JSON {error, code}.
        let warnText = 'Ошибка соединения. Попробуйте ещё раз.'
        try {
          const errJson = await response.json() as { error?: string; code?: string }
          if (errJson?.error) warnText = errJson.error
          if (errJson?.code === 'EDIT_PACKAGE_NEEDED') setPackageNeeded(true)
        } catch { /* тело не JSON — оставляем дефолт */ }
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'WARNING', content: warnText, createdAt: new Date().toISOString() },
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
            const parsed = JSON.parse(data) as { type?: string; chunk?: string; editsRemaining?: number; editsLimit?: number }

            if (parsed.type === 'done' && typeof parsed.editsRemaining === 'number') {
              // Сервер сообщает остаток пакета после успешной правки
              setEditQuota((prev) => prev ? { ...prev, remaining: parsed.editsRemaining!, limit: parsed.editsLimit ?? prev.limit, used: (parsed.editsLimit ?? prev.limit) - parsed.editsRemaining! } : prev)
            }

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
        // Сохраняем снапшот для отмены
        const snapshot = streamingDoc ?? docContent ?? ''
        if (snapshot) {
          undoStackRef.current = [...undoStackRef.current.slice(-4), snapshot]
          setCanUndo(true)
        }
        setDocContent(updatedDoc)
        setExternalKey((k) => k + 1) // внешнее изменение — заменить содержимое редактора
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

  // Фиксирует текущие (возможно несохранённые) правки как новую версию документа.
  // Возвращает id версии, которую нужно покупать/скачивать дальше.
  async function persistEditsAsNewVersion(): Promise<string | null> {
    if (!version) return null
    // Оплата и подпись относятся к конкретной версии и не переносятся на новую —
    // у свежей версии ещё нет Purchase, поэтому статус «Оплачено»/«Подписан»
    // переносить нельзя (иначе версия будет помечена оплаченной без реальной оплаты).
    const carryOverStatus = (version.status === 'PAID' || version.status === 'SIGNED')
      ? 'IN_PROGRESS'
      : version.status
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
        status: carryOverStatus,
        // Передаём текущий (отредактированный) текст документа
        content: docContent ?? undefined,
      }),
    })
    if (!res.ok) return null
    const newVersion = await res.json() as { id: string }
    setHasUnsavedEdits(false)
    // Правки зафиксированы как версия — рабочая копия больше не нужна
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    dirtyRef.current = false
    draftRevisionRef.current = 0
    await fetch(`/api/documents/${id}/draft`, { method: 'DELETE' }).catch(() => {})
    // A.6: фоновое применение форматирования к новой версии (не блокирует переход)
    fetch(`/api/versions/${newVersion.id}/apply-formatting`, { method: 'POST' }).catch(() => {})
    return newVersion.id
  }

  async function saveAsNewVersion() {
    if (!version || saving) return
    setSaveConfirmOpen(false)
    setSaving(true)
    try {
      const newVersionId = await persistEditsAsNewVersion()
      if (newVersionId) router.push(`/documents/${id}`)
    } finally {
      setSaving(false)
    }
  }

  // Кнопка «Назад»: если ИИ отредактировал документ, но правки не зафиксированы
  // как версия — предупреждаем и предлагаем сохранить, чтобы не потерять изменения.
  function handleBack() {
    if (hasUnsavedEdits) { setBackConfirmOpen(true); return }
    router.push(`/documents/${id}`)
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

  // Гейт «Оформление»: перед первым скачиванием нового документа предлагаем
  // собрать шапку и реквизиты (legacy-версии со вклеенными блоками — сразу качаем).
  function downloadDocx() {
    if (!version || downloading) return
    if (!legacyInline && !decor?.confirmed) {
      setDecorModalOpen(true)
      return
    }
    void performDownload(false)
  }

  async function performDownload(bare: boolean) {
    if (!version || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/versions/${version.id}/download${bare ? '?bare=1' : ''}`)
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

  const STATUS_OPTIONS = [
    { value: 'DRAFT', label: 'Черновик', color: 'var(--ink-3)' },
    { value: 'IN_PROGRESS', label: 'В работе', color: 'oklch(0.45 0.10 235)' },
    { value: 'REVIEW', label: 'На проверке', color: 'oklch(0.45 0.10 75)' },
    { value: 'APPROVED', label: 'Утверждено', color: 'var(--ok)' },
  ]
  const effectiveStatusValue = version.status
  const currentStatus = STATUS_OPTIONS.find(s => s.value === effectiveStatusValue)
  const currentStatusLabel = currentStatus?.label ?? effectiveStatusValue
  const currentStatusColor = currentStatus?.color ?? 'var(--ink-3)'
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
          { key: 'chat', label: 'Догодок-чат' },
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
      <div className={['flex-1 flex flex-col', mobileTab === 'chat' ? 'hidden md:flex' : 'flex'].join(' ')} style={{ borderRight: '1px solid var(--line)', minWidth: 0, overflow: 'hidden' }}>

        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-[6px] px-[12px]"
          style={{ height: 52, borderBottom: '1px solid var(--line)', background: 'var(--bg)', flexWrap: 'nowrap', minWidth: 0 }}>

          {/* Навигация назад + мета */}
          <button
            onClick={handleBack}
            className="shrink-0 flex items-center gap-[5px] h-[30px] px-[10px] rounded-[var(--radius-md)] text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer border border-[var(--line-2)]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span className="hidden md:inline">Назад</span>
          </button>

          <span className="shrink-0 text-[12px] text-[var(--ink-2)]" style={{ fontFamily: 'var(--font-mono)' }}>
            v.{version.number}{charCount > 0 ? ` · ~${charCount.toLocaleString('ru')} зн. / ~${wordCount.toLocaleString('ru')} сл.` : ''}
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
          </div>

          {/* Разделитель */}
          <div className="hidden md:block w-px h-[24px] bg-[var(--line)] mx-[4px] shrink-0" />

          {/* ── Документ-функции ── */}
          <div className="flex items-center gap-[8px]">

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
                    Сохранить как версию v.{maxVersionNumber + 1}?
                  </p>
                  <p className="text-[11px] text-[var(--ink-4)] mb-[14px] leading-[1.5]">
                    Текущий текст будет сохранён как новая версия. В истории уже {maxVersionNumber} {maxVersionNumber === 1 ? 'версия' : maxVersionNumber < 5 ? 'версии' : 'версий'}.
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
                      Сохранить v.{maxVersionNumber + 1}
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
                  disabled={statusChanging}
                  className="h-[30px] w-[120px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between gap-[4px]"
                  style={{ background: 'transparent', borderColor: 'var(--line-2)', color: 'var(--ink-3)' }}
                >
                  <span className="flex items-center gap-[6px] truncate">
                    <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: currentStatusColor }} />
                    <span className="truncate">{currentStatusLabel}</span>
                  </span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {statusDropdownOpen && (
                  <div className="absolute right-0 top-[34px] z-50 rounded-[var(--radius-md)] overflow-hidden min-w-[150px]"
                    style={{ background: 'white', border: '1px solid var(--line-2)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                    {STATUS_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => changeStatus(opt.value)}
                        className="w-full text-left px-[12px] py-[8px] text-[12px] hover:bg-[var(--surface-inset)] transition-colors cursor-pointer flex items-center gap-[8px]"
                        style={{ color: opt.value === effectiveStatusValue ? 'var(--ink)' : 'var(--ink-3)', fontWeight: opt.value === effectiveStatusValue ? 600 : 400 }}>
                        <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: opt.color }} />
                        {opt.label}
                        {opt.value === effectiveStatusValue && ' ✓'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Переписать заново — только для загруженных документов */}
            {editQuota?.isUploaded && !generating && docContent && (
              <div className="relative hidden md:block">
                <button
                  onClick={() => setRewriteConfirmOpen(v => !v)}
                  disabled={rewriting || streaming}
                  className="shrink-0 h-[30px] px-[10px] rounded-[var(--radius-md)] text-[12px] font-medium text-[var(--ink)] border border-[var(--line-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-40"
                >
                  {rewriting ? 'Запускаю…' : 'Переписать заново'}
                </button>
                {rewriteConfirmOpen && (
                  <div
                    className="absolute right-0 top-[38px] z-50 rounded-[var(--radius-lg)] w-[280px]"
                    style={{ background: 'white', border: '1px solid var(--line-2)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '16px' }}
                  >
                    <p className="text-[12px] font-medium text-[var(--ink)] mb-[4px]">
                      Переписать документ заново?
                    </p>
                    <p className="text-[11px] text-[var(--ink-4)] mb-[14px] leading-[1.5]">
                      Догодок полностью перепишет договор по мотивам текущего текста — создастся новая версия.
                      Спишется {editQuota.prices.rewrite} токенов, в цену входит пакет из 10 правок.
                    </p>
                    <div className="flex gap-[6px]">
                      <button
                        onClick={() => setRewriteConfirmOpen(false)}
                        className="flex-1 h-[30px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--surface-inset)] text-[var(--ink-3)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={rewriteDocument}
                        className="flex-1 h-[30px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        Переписать
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Скачать DOCX — предоплатная модель: доступно всегда */}
            <button
              onClick={downloadDocx}
              disabled={downloading || generating || !docContent}
              className="shrink-0 h-[30px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-[4px]"
            >
              {downloading ? (
                <div className="w-[8px] h-[8px] rounded-full border border-[var(--ink-3)] border-t-transparent animate-spin" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              )}
              <span className="hidden md:inline">{downloading ? 'Скачиваю…' : 'Скачать'}</span>
            </button>

            {/* Печать */}
            <button
              onClick={() => window.print()}
              disabled={generating || !docContent}
              className="shrink-0 h-[30px] w-[30px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              title="Печать"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            </button>
          </div>
        </div>

        {/* Тело документа */}
        {genError ? (
          <GenerationErrorScreen docTitle={docTitle} onRetry={async () => {
            const vId = genVersionIdRef.current
            if (!vId) return
            // Сначала проверяем — вдруг документ уже сгенерирован (таймаут сработал раньше)
            const checkRes = await fetch(`/api/documents/${id}`)
            if (checkRes.ok) {
              const doc = await checkRes.json()
              const ver = doc.versions.find((v: Version) => v.id === vId)
              if (ver?.content) {
                setDocContent(ver.content)
                setVersion((prev) => prev ? { ...prev, content: ver.content } : prev)
                setGenError(false)
                return
              }
            }
            setGenError(false)
            setGenerating(true)
            setGenProgress(0)
            genStartRef.current = Date.now()
            const genRes = await fetch(`/api/versions/${vId}/generate`, { method: 'POST' })
            if (genRes.ok) {
              const { jobId, status } = await genRes.json()
              if (status === 'already_generated') {
                setGenerating(false)
              } else if (jobId) {
                pollJob(jobId, vId)
              }
            } else {
              setGenerating(false)
              setGenError(true)
            }
          }} />
        ) : generating ? (
          <GeneratingScreen done={genProgress === 100} docTitle={docTitle} />
        ) : (
          <div className="flex-1 overflow-y-auto relative" style={{ background: '#DEDAD3', padding: '0' }}>
            {/* Индикатор обновления документа ИИ — всё время генерации */}
            {streaming && (
              <div
                className="sticky top-[16px] z-10 flex items-center gap-[8px] px-[14px] py-[7px] rounded-full shadow-md mx-auto w-fit"
                style={{ background: 'var(--ink)', color: 'var(--bg)' }}
              >
                <div className="w-[10px] h-[10px] rounded-full border-2 border-white/30 border-t-white animate-spin" />
                <span className="text-[12px] font-medium">Догодок работает над документом…</span>
              </div>
            )}

            {/* Тулбар ручного редактирования — плавает над листом */}
            {!streaming && docContent && (
              <div
                className="sticky top-[12px] z-10 mx-auto w-fit rounded-[var(--radius-md)] px-[6px] py-[4px]"
                style={{ background: 'var(--bg)', border: '1px solid var(--line-2)', boxShadow: '0 2px 10px rgba(0,0,0,0.10)' }}
              >
                <EditorToolbar editor={editorInstance} />
              </div>
            )}

            {/* Единый лист — бумажный вид */}
            <div
              className="mx-auto relative"
              style={{
                width: 'calc(100% - 48px)',
                maxWidth: 794,
                minHeight: 1123,
                background: 'white',
                padding: '96px 8% 80px',
                marginTop: 32,
                marginBottom: 48,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 20px rgba(0,0,0,0.13)',
              }}
            >
              {(() => {
                const displayText = streamingDoc !== null ? streamingDoc : docContent
                const isUpdating = streaming

                if (!displayText) {
                  return (
                    <div className="flex flex-col items-center justify-center h-[400px] gap-[12px] relative z-[2]">
                      <p className="text-[14px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-serif)' }}>Документ пуст</p>
                      <p className="text-[12px] text-[var(--ink-4)]">Попросите Догодка создать или отредактировать договор</p>
                    </div>
                  )
                }

                return (
                  <div className="relative z-[2]" style={{ opacity: isUpdating ? 0.6 : 1, transition: 'opacity 0.3s' }}>
                    {/* Слой оформления: шапка над телом (редактируется по клику) */}
                    {!legacyInline && decor?.preambleHtml && (
                      <DecorBlock
                        html={decor.preambleHtml}
                        hint="Шапка · оформление, кликните чтобы поправить"
                        onSave={(html) => void patchDecor({ preambleHtml: html })}
                      />
                    )}
                    {!legacyInline && !decor?.preambleHtml && !streaming && (
                      <div className="mb-[16px] flex items-center justify-between gap-[10px] rounded-[var(--radius-md)] px-[12px] py-[8px]"
                        style={{ background: 'var(--surface-inset)', border: '1px dashed var(--line-2)' }}>
                        <p className="text-[11.5px] text-[var(--ink-4)]">Шапка и реквизиты добавятся при скачивании</p>
                        <button
                          onClick={() => setDecorModalOpen(true)}
                          className="shrink-0 text-[11.5px] font-medium text-[var(--accent-ink)] hover:underline cursor-pointer"
                        >
                          Настроить сейчас
                        </button>
                      </div>
                    )}
                    <DocumentViewer
                      content={displayText}
                      editable={!streaming && !generating}
                      onUpdate={(html) => {
                        // Ручная правка в предпросмотре — тот же путь, что ИИ-правка
                        setDocContent(html)
                        setHasUnsavedEdits(true)
                        scheduleAutosave(html)
                      }}
                      externalContentKey={externalKey}
                      onEditorReady={setEditorInstance}
                    />
                    {/* Слой оформления: реквизиты под телом */}
                    {!legacyInline && decor?.requisitesHtml && (
                      <DecorBlock
                        html={decor.requisitesHtml}
                        hint="Реквизиты · оформление, кликните чтобы поправить"
                        onSave={(html) => void patchDecor({ requisitesHtml: html })}
                      />
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
            <span className="text-[13px] font-medium text-[var(--ink)]">Чат с Догодком</span>
          </div>
          <div className="flex items-center gap-[4px]">
            {canUndo && !streaming && !generating && (
              <button
                onClick={() => {
                  const prev = undoStackRef.current.pop()
                  if (prev) {
                    setDocContent(prev)
                    setExternalKey((k) => k + 1) // заменить содержимое редактора
                    setHasUnsavedEdits(true)
                    scheduleAutosave(prev)
                    setMessages((msgs) => [...msgs, {
                      id: `undo-${Date.now()}`,
                      role: 'WARNING' as const,
                      content: 'Изменения отменены. Документ восстановлен.',
                      createdAt: new Date().toISOString(),
                    }])
                  }
                  if (undoStackRef.current.length === 0) setCanUndo(false)
                }}
                className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium text-[#DC2626] bg-[#FEE2E2] hover:bg-[#FECACA] transition-colors cursor-pointer flex items-center gap-[4px]"
                title="Отменить последнее изменение Догодка"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
                Отменить
              </button>
            )}
            {docContent && !generating && (
              <button
                onClick={() => sendMessage('Проверь этот договор: укажи 3-5 конкретных слабых места и дай рекомендации по улучшению каждого пункта.', 'quick_analysis')}
                disabled={streaming}
                className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px] disabled:opacity-50"
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
                <p className="text-[14px] font-medium text-[var(--ink)] mb-[4px]">
                  {chatMode === 'edit' ? 'Готов помочь с договором' : 'Могу ответить на вопросы'}
                </p>
                <p className="text-[12px] text-[var(--ink-4)] max-w-[240px]">
                  {chatMode === 'edit'
                    ? 'Попросите внести правку, усилить пункт или переформулировать условие'
                    : 'Спросите про смысл пункта, риски или условия — документ не изменится'}
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

        {/* Режим: правка или вопрос */}
        <div className="shrink-0 px-[12px] pb-[8px] flex items-center justify-between gap-[8px]">
          <div
            className="inline-flex p-[3px] rounded-full"
            style={{ background: 'var(--surface-inset)', border: '1px solid var(--line)' }}
            role="tablist"
            aria-label="Режим чата"
          >
            {([
              { id: 'edit' as const, label: 'Правка' },
              { id: 'chat' as const, label: 'Вопрос' },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={chatMode === tab.id}
                disabled={streaming || generating}
                onClick={() => setChatMode(tab.id)}
                className={[
                  'h-[28px] px-[14px] rounded-full text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-50',
                  chatMode === tab.id
                    ? 'bg-[var(--ink)] text-[var(--bg)]'
                    : 'text-[var(--ink-3)] hover:text-[var(--ink)]',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Остаток пакета ИИ-правок (правки платные, вопросы бесплатны) */}
          {chatMode === 'edit' && editQuota && editQuota.limit > 0 && (
            <span
              className="text-[11px] font-medium whitespace-nowrap"
              style={{ color: editQuota.remaining === 0 ? 'var(--danger)' : 'var(--ink-4)' }}
              title="В оплаченную генерацию входит пакет ИИ-правок; вопросы не тратят пакет"
            >
              Правок осталось: {editQuota.remaining} из {editQuota.limit}
            </span>
          )}
          {chatMode === 'edit' && editQuota && editQuota.isUploaded && editQuota.packages === 0 && (
            <span className="text-[11px] font-medium whitespace-nowrap text-[var(--ink-4)]"
              title="Для загруженного документа первая правка открывает пакет из 10 правок">
              Первая правка · {editQuota.prices.uploadEditStart ?? 50} токенов
            </span>
          )}
        </div>

        {/* Пакет исчерпан — предложение докупки */}
        {packageNeeded && chatMode === 'edit' && (
          <div className="shrink-0 mx-[12px] mb-[8px] rounded-[var(--radius-md)] px-[12px] py-[10px] flex items-center justify-between gap-[10px]"
            style={{ background: 'oklch(0.97 0.015 60)', border: '1px solid oklch(0.88 0.04 60)' }}>
            <p className="text-[12px]" style={{ color: 'oklch(0.45 0.08 60)' }}>
              Пакет правок исчерпан
            </p>
            <button
              onClick={buyEditPackage}
              disabled={buyingPackage}
              className="shrink-0 h-[28px] px-[10px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            >
              {buyingPackage ? 'Покупаю…' : `Купить 10 правок · ${editQuota?.prices.editPackage ?? 100} токенов`}
            </button>
          </div>
        )}

        {/* Быстрые чипы */}
        <div className="shrink-0 px-[12px] pb-[8px] flex gap-[6px] flex-wrap">
          {(chatMode === 'edit' ? QUICK_CHIPS_EDIT : QUICK_CHIPS_CHAT).map((chip) => (
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
              placeholder={
                generating
                  ? 'Документ ещё генерируется…'
                  : chatMode === 'edit'
                    ? 'Попросите внести правку…'
                    : 'Задайте вопрос по договору…'
              }
              rows={1}
              disabled={streaming || generating}
              className="flex-1 resize-none bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-4)] outline-none leading-[1.5] disabled:opacity-50"
              style={{ maxHeight: 120, overflowY: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
            />

            <button onClick={() => sendMessage()} disabled={!input.trim() || streaming || generating}
              className="shrink-0 w-[32px] h-[32px] rounded-[var(--radius-md)] bg-[var(--ink)] text-[var(--bg)] flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <p className="mt-[6px] text-[11px] text-[var(--ink-4)] px-[2px]">
            {chatMode === 'edit'
              ? 'Режим правки — Догодок изменит текст документа'
              : 'Режим вопроса — только ответ в чате, документ не меняется'}
          </p>
        </div>
      </div>
    </div>

    {/* Шаг «Оформление» перед скачиванием */}
    <DecorModal
      documentId={id}
      counterpartyId={version.document?.counterparty?.id ?? null}
      open={decorModalOpen}
      onClose={() => setDecorModalOpen(false)}
      onConfirmed={(opts) => {
        setDecorModalOpen(false)
        void refreshDecor()
        void performDownload(Boolean(opts?.bare))
      }}
    />

    {/* Предупреждение о несохранённых правках при выходе «Назад» */}
    {backConfirmOpen && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setBackConfirmOpen(false)} />
        <div
          className="relative z-10 w-[360px] rounded-[var(--radius-xl)] p-[24px] flex flex-col gap-[16px]"
          style={{ background: 'var(--bg)', border: '1px solid var(--line)', boxShadow: '0 16px 40px rgba(0,0,0,0.14)' }}
        >
          <div>
            <p className="text-[15px] font-semibold text-[var(--ink)] mb-[6px]">Версия не сохранена</p>
            <p className="text-[13px] text-[var(--ink-3)] leading-[1.5]">
              Документ отредактирован через Догодок, но правки ещё не зафиксированы как версия. Сохраните новую версию, чтобы не потерять изменения.
            </p>
          </div>
          <div className="flex flex-col gap-[8px]">
            <button
              onClick={() => { setBackConfirmOpen(false); saveAsNewVersion() }}
              disabled={saving}
              className="h-[36px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            >
              {saving ? 'Сохраняю…' : `Сохранить как v.${maxVersionNumber + 1} и выйти`}
            </button>
            <div className="flex gap-[8px]">
              <button
                onClick={() => setBackConfirmOpen(false)}
                className="flex-1 h-[38px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium text-[var(--ink-2)] bg-[var(--surface)] border border-[var(--line-2)] hover:bg-[var(--surface-2)] hover:border-[var(--ink-4)] transition-colors cursor-pointer"
              >
                Остаться
              </button>
              <button
                onClick={() => { setBackConfirmOpen(false); router.push(`/documents/${id}`) }}
                className="flex-1 h-[38px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium text-[var(--danger)] bg-transparent border border-[oklch(0.85_0.06_20)] hover:bg-[oklch(0.97_0.015_20)] transition-colors cursor-pointer"
              >
                Выйти без сохранения
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
