'use client'

import React, { useState, useEffect, useRef, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { calcVersionPrice } from '@/lib/pricing'
import { useTopbarStore } from '@/store/topbar'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface BankDetail { bankName: string | null; checkingAccount: string | null; bik: string | null; correspondentAccount: string | null }
interface Signatory { fullName: string; position: string | null; basisType: string; poaNumber: string | null }
interface RequisitesParty {
  name: string
  type: string
  inn: string | null
  kpp: string | null
  ogrn: string | null
  legalAddress: string | null
  email: string | null
  signatorName: string | null
  signatorPosition: string | null
  bankDetails: BankDetail[]
  signatories: Signatory[]
}

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
    number: string | null
    signingDate: string | null
    counterparty: { name: string }
  }
  purchase?: { id: string } | null
}

// ─── Константы ────────────────────────────────────────────────────────────────

const QUICK_CHIPS = [
  'Изменить реквизиты',
  'Добавить неустойку',
  'Усилить конфиденциальность',
  'Уточнить сроки оплаты',
  'Добавить форс-мажор',
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

// ─── Блок реквизитов и подписей (формируется из БД, не ИИ) ───────────────────

function RequisitesBlock({ myParty, counterparty, myRole }: {
  myParty: RequisitesParty | null
  counterparty: RequisitesParty | null
  myRole: string
}) {
  const otherRole = myRole === 'Заказчик' ? 'Исполнитель' : 'Заказчик'

  function PartyRequisites({ party, role }: { party: RequisitesParty | null; role: string }) {
    if (!party) return <div />
    const bank = party.bankDetails[0]
    const signatory = party.signatories[0]
    const isIP = party.type === 'SOLE_PROPRIETOR'
    const ogrnLabel = isIP ? 'ОГРНИП' : 'ОГРН'

    const signerName = signatory?.fullName ?? party.signatorName ?? party.name
    const signerPosition = isIP ? `Индивидуальный предприниматель ${party.name}` : (signatory?.position ?? party.signatorPosition ?? 'Директор')

    const rows: { label: string; value: string | null }[] = [
      { label: role + ':', value: party.name },
      { label: 'Адрес:', value: party.legalAddress },
      { label: 'ИНН:', value: party.inn },
      ...(!isIP ? [{ label: 'КПП:', value: party.kpp }] : []),
      { label: ogrnLabel + ':', value: party.ogrn },
      { label: 'Р/счет:', value: bank?.checkingAccount ?? null },
      { label: 'К/счет:', value: bank?.correspondentAccount ?? null },
      { label: 'Банк:', value: bank?.bankName ?? null },
      { label: 'БИК:', value: bank?.bik ?? null },
      { label: 'E-mail:', value: party.email },
    ].filter(r => r.value)

    return (
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, lineHeight: '1.5' }}>
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap', minWidth: 80 }}>{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
        <div style={{ marginTop: 40 }}>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 32 }}>{signerPosition}</div>
          <div style={{ borderBottom: '1px solid #111', width: 220, marginBottom: 8 }} />
          <div style={{ fontSize: 13 }}>{signerName}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>М.П.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #ddd' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        13. Реквизиты и подписи сторон
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        <PartyRequisites party={myParty} role={myRole} />
        <PartyRequisites party={counterparty} role={otherRole} />
      </div>
    </div>
  )
}

// ─── Красивый рендер текста договора ─────────────────────────────────────────

// ─── Inline-форматирование ────────────────────────────────────────────────────

// ─── Рендер договора (без внешних зависимостей) ──────────────────────────────

function stripRequisitesFromText(text: string): string {
  const lines = text.split('\n')
  const cutPatterns = [
    /^#{1,6}\s*РЕКВИЗИТЫ/i,
    /^#{1,6}\s*\d+\.\s*РЕКВИЗИТЫ/i,
    /^РЕКВИЗИТЫ\s*(И\s*ПОДПИСИ)?\s*(СТОРОН)?/i,
    /^\d+\.\s*РЕКВИЗИТЫ\s*(И\s*ПОДПИСИ)?\s*(СТОРОН)?/i,
    /^Место\s+нахождения\s+и\s+банковские\s+реквизиты/i,
  ]
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/, '').trim()
    if (cutPatterns.some(p => p.test(c))) return lines.slice(0, i).join('\n').trimEnd()
  }
  return text
}

// Рендер inline: **жирный** → <strong>
function renderInlineMd(text: string, key: number): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<strong key={k++}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <React.Fragment key={key}>{parts}</React.Fragment>
}

function DocumentRenderer({ text, canCopy, docTitle, docNumber, docDate }: {
  text: string
  canCopy: boolean
  docTitle?: string
  docNumber?: string | null
  docDate?: string | null
}) {
  const cleaned = stripRequisitesFromText(text)
  const lines = cleaned.split('\n')

  // Проверяем есть ли заголовок договора в первых строках
  const firstLines = lines.slice(0, 5).join(' ')
  const hasTitle = /договор|соглашение|приложение|акт|контракт/i.test(firstLines)

  const elements: React.ReactNode[] = []

  if (!hasTitle && docTitle) {
    elements.push(
      <div key="meta" style={{ textAlign: 'center', marginBottom: 24 }}>
        <p style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase', fontFamily: "'Times New Roman', serif", marginBottom: 4 }}>
          {docTitle}
        </p>
        {(docNumber || docDate) && (
          <p style={{ fontSize: 13, color: '#555' }}>
            {docNumber ? `№ ${docNumber}` : ''}{docNumber && docDate ? ' ' : ''}{docDate ? `от ${docDate} г.` : ''}
          </p>
        )}
      </div>
    )
  }

  lines.forEach((raw, i) => {
    // Убираем ведущие # (##, ###, ####)
    const isHeading = /^#{1,6}\s/.test(raw)
    const line = raw.replace(/^#{1,6}\s*/, '').trim()

    if (!line) {
      elements.push(<div key={i} style={{ height: 10 }} />)
      return
    }

    // Заголовок раздела: строка начинается с ## / ### или это "N. СЛОВА КАПС"
    const isSectionHeading = isHeading || /^\d+\.\s+[А-ЯA-Z\s«»(),\-–—]{4,}$/.test(line)

    if (isSectionHeading) {
      elements.push(
        <p key={i} style={{ fontWeight: 700, fontSize: 14, fontFamily: "'Times New Roman', serif", textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
          {renderInlineMd(line, i)}
        </p>
      )
      return
    }

    // Подпункт: 1.1. или 1.1.1.
    if (/^\d+\.\d+/.test(line)) {
      const depth = (line.match(/^\d+(?:\.\d+)+/)?.[0].split('.').length ?? 2) - 1
      elements.push(
        <p key={i} style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 4, paddingLeft: depth > 1 ? (depth - 1) * 24 : 0, textAlign: 'justify' }}>
          {renderInlineMd(line, i)}
        </p>
      )
      return
    }

    // Обычный абзац
    elements.push(
      <p key={i} style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 6, textAlign: 'justify' }}>
        {renderInlineMd(line, i)}
      </p>
    )
  })

  return (
    <div
      style={{ fontFamily: "'Times New Roman', Georgia, serif", color: '#111', userSelect: canCopy ? 'text' : 'none' }}
      onCopy={!canCopy ? (e) => e.preventDefault() : undefined}
    >
      {elements}
    </div>
  )
}

// legacy — не используется, оставлено для совместимости
function renderInline(text: string): React.ReactNode[] {
  // Сначала удаляем лишние звёздочки markdown-форматирования и применяем inline-стили
  const parts: React.ReactNode[] = []

  // Паттерны:
  // **text** → <strong>
  // *text* → <em>
  // «text» → <strong> (кавычки)
  // ООО/АНО/ПАО/ЗАО/ИП + следующие слова до запятой/скобки/конца → <strong>
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|«([^»]+)»|((?:ООО|АНО|ПАО|ЗАО|ИП|Общество с ограниченной|Индивидуальный предприниматель)\s+[^\s,;()]+(?:\s+[^\s,;()]+){0,5})/g

  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1] !== undefined) parts.push(<strong key={key++}>{match[1]}</strong>)
    else if (match[2] !== undefined) parts.push(<em key={key++}>{match[2]}</em>)
    else if (match[3] !== undefined) parts.push(<React.Fragment key={key++}>«<strong>{match[3]}</strong>»</React.Fragment>)
    else if (match[4] !== undefined) parts.push(<strong key={key++}>{match[4]}</strong>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}


// ─── Экран генерации (пока документ создаётся) ───────────────────────────────

const GENERATION_STAGES = [
  { until: 12,  text: 'Анализирую задачу…' },
  { until: 30,  text: 'Формирую структуру договора…' },
  { until: 60,  text: 'Составляю основные разделы…' },
  { until: 80,  text: 'Прописываю условия и ответственность…' },
  { until: 92,  text: 'Добавляю финальные пункты…' },
  { until: 96,  text: 'Применяю форматирование…' },
  { until: 100, text: 'Финализирую документ…' },
]

function GeneratingScreen({ progress, docTitle }: { progress: number; docTitle: string }) {
  // "Мягкий" прогресс — ползёт вперёд между реальными обновлениями (не более чем на 5% впереди реального)
  const [displayProgress, setDisplayProgress] = useState(progress)
  const displayRef = useRef(progress)
  const realRef = useRef(progress)

  useEffect(() => { realRef.current = progress }, [progress])

  useEffect(() => {
    const tick = setInterval(() => {
      const real = realRef.current
      const cur = displayRef.current
      // Максимум 5% впереди реального; прирост 0.4% в 200мс = ~2%/сек
      const cap = Math.min(real + 5, 100)
      if (cur < cap) {
        const next = Math.min(cur + 0.4, cap)
        displayRef.current = next
        setDisplayProgress(Math.round(next * 10) / 10)
      }
    }, 200)
    return () => clearInterval(tick)
  }, [])

  const stage = GENERATION_STAGES.find((s) => displayProgress <= s.until) ?? GENERATION_STAGES[GENERATION_STAGES.length - 1]
  const pct = Math.min(Math.round(displayProgress), 100)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-[20px]"
      style={{ background: 'var(--bg-soft)' }}>

      {/* Иконка с пульсацией */}
      <div className="relative">
        <div className="w-[64px] h-[64px] rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <span className="text-[24px]"
            style={{ animation: 'genSpin 3s linear infinite', display: 'inline-block' }}>✦</span>
        </div>
        {/* Пульсирующее кольцо */}
        <div className="absolute inset-0 rounded-full"
          style={{ border: '2px solid var(--accent)', opacity: 0.3, animation: 'genPulse 2s ease-in-out infinite' }} />
      </div>

      {/* Название */}
      <div className="text-center">
        <p className="text-[15px] font-medium text-[var(--ink)] mb-[4px]"
          style={{ fontFamily: 'var(--font-serif)' }}>
          {stage?.text ?? 'Генерирую документ…'}
        </p>
        <p className="text-[12px] text-[var(--ink-4)]">{docTitle}</p>
      </div>

      {/* Прогресс-бар */}
      <div className="flex flex-col items-center gap-[8px]">
        <div className="w-[280px] h-[4px] rounded-full overflow-hidden"
          style={{ background: 'var(--line)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'var(--accent)',
              transition: 'width 0.2s ease-out',
            }}
          />
        </div>
        <div className="flex items-center gap-[8px]">
          {/* Точки-индикаторы активности */}
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-[4px] h-[4px] rounded-full"
              style={{
                background: 'var(--accent)',
                opacity: 0.7,
                animation: `genDot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
          ))}
          <p className="text-[11px] text-[var(--ink-4)]"
            style={{ fontFamily: 'var(--font-mono)', minWidth: 32, textAlign: 'right' }}>
            {pct}%
          </p>
        </div>
      </div>

      <style>{`
        @keyframes genSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes genPulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.15); opacity: 0.1; } }
        @keyframes genDot { 0%, 80%, 100% { transform: scale(0.7); opacity: 0.3; } 40% { transform: scale(1.2); opacity: 1; } }
      `}</style>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const setPageTitle = useTopbarStore((s) => s.setPageTitle)

  const [version, setVersion] = useState<Version | null>(null)
  const [loading, setLoading] = useState(true)
  const [docParties, setDocParties] = useState<{ myParty: RequisitesParty | null; counterparty: RequisitesParty | null; myRole: string } | null>(null)
  const [docContent, setDocContent] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState(0)
  const docView = 'formatted'
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
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false) // есть несохранённые ИИ-правки
  const [maxVersionNumber, setMaxVersionNumber] = useState<number>(1) // максимальный номер версии по документу
  const [applyingFormat, setApplyingFormat] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [purchased, setPurchased] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false)
  const [aiSettingsForm, setAiSettingsForm] = useState({
    protectionLevel: (version?.aiSettings as any)?.protectionLevel ?? 70,
    targetSize: (version?.aiSettings as any)?.targetSize ?? 8000,
  })
  const [savingSettings, setSavingSettings] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Polling статуса задачи генерации
  const pollJob = useCallback(async function runPoll(jobId: string, versionId: string) {
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (!res.ok) return

      const job = await res.json()
      setGenProgress(job.progress ?? 0)

      if (job.state === 'completed') {
        // Сначала ставим 100% и ждём пока анимация доберётся до конца
        setGenProgress(100)

        // Загружаем контент параллельно с анимацией
        const vRes = await fetch(`/api/documents/${id}`)
        if (vRes.ok) {
          const doc = await vRes.json()
          const ver = doc.versions.find((v: Version) => v.id === versionId)
          if (ver?.content) {
            setDocContent(ver.content)
            setVersion((prev) => prev ? { ...prev, content: ver.content, status: 'DRAFT' } : prev)
          }
        }

        // Задержка: даём анимации добежать до 100% (≈1.5с)
        setTimeout(() => {
          setGenerating(false)
        }, 1500)
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
          document: { id: doc.id, title: doc.title, type: doc.type, number: doc.number ?? null, signingDate: doc.signingDate ?? null, counterparty: doc.counterparty },
        }
        setVersion(versionWithDoc)
        setPageTitle(doc.title)

        // Формируем данные для блока реквизитов
        const aiRole = (ver.aiSettings as { userRole?: string } | null)?.userRole
        const myRole = aiRole === 'executor' ? 'Исполнитель' : 'Заказчик'

        const profRaw = doc.profile as (RequisitesParty & { bankDetails: BankDetail[] }) | null
        const ctrRaw = doc.counterparty as (Omit<RequisitesParty, 'type'> & { kpp?: string | null; bankDetails: BankDetail[]; signatories: Signatory[] }) | null

        const myParty: RequisitesParty | null = profRaw ? {
          name: profRaw.name,
          type: profRaw.type,
          inn: profRaw.inn ?? null,
          kpp: profRaw.kpp ?? null,
          ogrn: profRaw.ogrn ?? null,
          legalAddress: profRaw.legalAddress ?? null,
          email: null,
          signatorName: (profRaw as unknown as { signatorName?: string | null }).signatorName ?? null,
          signatorPosition: (profRaw as unknown as { signatorPosition?: string | null }).signatorPosition ?? null,
          bankDetails: (profRaw.bankDetails ?? []) as BankDetail[],
          signatories: [],
        } : null

        const counterpartyParty: RequisitesParty | null = ctrRaw ? {
          name: ctrRaw.name,
          type: ctrRaw.kpp ? 'COMPANY' : 'SOLE_PROPRIETOR',
          inn: ctrRaw.inn ?? null,
          kpp: ctrRaw.kpp ?? null,
          ogrn: ctrRaw.ogrn ?? null,
          legalAddress: ctrRaw.legalAddress ?? null,
          email: ctrRaw.email ?? null,
          signatorName: ctrRaw.signatorName ?? null,
          signatorPosition: ctrRaw.signatorPosition ?? null,
          bankDetails: (ctrRaw.bankDetails ?? []) as BankDetail[],
          signatories: (ctrRaw.signatories ?? []) as Signatory[],
        } : null

        setDocParties({ myParty, counterparty: counterpartyParty, myRole })

        // Запоминаем максимальный номер версии по всему документу
        const allVersions = doc.versions as Array<{ number: number }>
        const maxNum = allVersions.reduce((m, v) => Math.max(m, v.number), 0)
        setMaxVersionNumber(maxNum)

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
      setPageTitle(null)
    }
  }, [id, pollJob, router, setPageTitle])

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

  async function applyAiSettings() {
    if (!version || savingSettings) return
    setSavingSettings(true)
    try {
      // Сохраняем настройки
      await fetch(`/api/versions/${version.id}/ai-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiSettingsForm),
      })

      // Отправляем в чат промпт адаптации
      const adaptPrompt = [
        'Адаптируй документ к новым параметрам:',
        `• Уровень защиты: ${aiSettingsForm.protectionLevel}%`,
        `• Целевой объём: ${aiSettingsForm.targetSize} знаков`,
        '',
        'Внеси только дополнения и изменения в существующий текст. Не переписывай полностью, только улучшай существующее.',
      ].join('\n')

      setInput(adaptPrompt)
      setAiSettingsOpen(false)
      textareaRef.current?.focus()
    } finally {
      setSavingSettings(false)
    }
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
            base: version.aiSettings?.base,
            description: 'Сохранено из рабочего экрана',
          },
          status: 'IN_PROGRESS',
          content: docContent || undefined,
        }),
      })
      if (res.ok) {
        const newVersion = await res.json() as { id: string; number: number }
        setHasUnsavedEdits(false)
        setMaxVersionNumber(newVersion.number ?? maxVersionNumber + 1)
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

  async function applyFormatting() {
    if (!version || applyingFormat) return
    setApplyingFormat(true)
    try {
      const res = await fetch(`/api/versions/${version.id}/apply-formatting`, { method: 'POST' })
      if (res.ok) {
        setVersion((prev) => prev ? { ...prev, formattingApplied: true } : prev)
        setDocHtml(null) // сбросим — useEffect перезагрузит новый HTML
      }
    } finally {
      setApplyingFormat(false)
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
  const isUploaded = version.aiSettings?.base === 'upload'
  const needsFormatting = isUploaded && !version.formattingApplied && Boolean(docContent)

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

          <span className="shrink-0 text-[12px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-mono)' }}>
            v.{version.number}
          </span>
          <div className="flex-1 min-w-0" />
          {hasUnsavedEdits && (
            <span className="hidden md:flex shrink-0 items-center gap-[4px] text-[11px] text-[oklch(0.55_0.08_60)]">
              <span className="w-[5px] h-[5px] rounded-full bg-[oklch(0.65_0.1_60)]" />
              Не сохранено
            </span>
          )}

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
                className="shrink-0 h-[30px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-[4px] border border-[var(--line-2)]"
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
                className="shrink-0 h-[30px] px-[9px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-4)] cursor-not-allowed opacity-40 hidden md:flex items-center gap-[4px] border border-[var(--line-2)]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                <span className="hidden md:inline">Скачать</span>
              </button>
            )}

            {/* Печать */}
            <button
              onClick={() => isPurchased && window.print()}
              disabled={!isPurchased || generating}
              className="shrink-0 h-[30px] w-[30px] rounded-[var(--radius-md)] text-[11px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed border border-[var(--line-2)]"
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
                className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
              >
                <div
                  className="flex items-center gap-[10px] px-[20px] py-[12px] rounded-full shadow-xl"
                  style={{ background: 'var(--ink)', color: 'var(--bg)' }}
                >
                  <div className="w-[12px] h-[12px] rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span className="text-[13px] font-medium">ИИ обновляет документ…</span>
                </div>
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
                // Контент может быть HTML (из загруженного DOCX через mammoth).
                // Проверяем по наличию HTML-тегов в тексте — не только по первому символу,
                // т.к. сохранённый контент может начинаться с текстового фрагмента.
                const isHtmlContent = !isUpdating && docView === 'formatted' && /<(p|ul|ol|li|table|tr|td|th|strong|em|h[1-6]|br|div|span)[^>]*>/i.test(displayText?.slice(0, 2000) ?? '')

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
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: docHtml }}
                      />
                    ) : isHtmlContent ? (
                      // Контент содержит HTML (из загруженного шаблона через mammoth)
                      <div
                        className="docx-rendered"
                        style={{ userSelect: isPurchased ? 'text' : 'none' }}
                        onCopy={!isPurchased ? (e) => e.preventDefault() : undefined}
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: displayText! }}
                      />
                    ) : (
                      // Структурированный рендер из plain text
                      <DocumentRenderer
                        text={displayText}
                        canCopy={isPurchased}
                        docTitle={version.document?.title}
                        docNumber={version.document?.number}
                        docDate={version.document?.signingDate
                          ? new Date(version.document.signingDate).toLocaleDateString('ru-RU')
                          : undefined}
                      />
                    )}
                    {/* Блок реквизитов из БД — только для plain text режима */}
                    {docParties && !showDocxHtml && (
                      <RequisitesBlock
                        myParty={docParties.myParty}
                        counterparty={docParties.counterparty}
                        myRole={docParties.myRole}
                      />
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* Счётчик символов и цена версии */}
        {docContent && !generating && (
          <div className="shrink-0 flex items-center justify-between px-[40px] py-[10px]"
            style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
            <span className="text-[12px] text-[var(--ink-2)]" style={{ fontFamily: 'var(--font-mono)' }}>
              ~{charCount.toLocaleString('ru-RU')} симв. / ~{wordCount.toLocaleString('ru-RU')} слов
            </span>
            {!isPurchased && (
              <span className="text-[11px] text-[var(--ink-3)]">
                Стоимость версии: <span className="font-semibold text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>{versionPrice} ₽</span>
              </span>
            )}
          </div>
        )}

      </div>

      {/* ── Правая колонка — ИИ-чат (420px фиксированная) ───────────── */}
      <div className={['shrink-0 flex flex-col', mobileTab === 'doc' ? 'hidden md:flex' : 'flex'].join(' ')} style={{ width: '100%', maxWidth: 420, background: '#ffffff', borderLeft: '1px solid var(--line)' }}>

        {/* Хедер чата */}
        <div className="shrink-0 flex items-center justify-between px-[20px]"
          style={{ height: 48, borderBottom: aiSettingsOpen ? 'none' : '1px solid var(--line)' }}>
          <div className="flex items-center gap-[8px]">
            <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center"
              style={{ background: 'var(--accent)' }}>
              <span className="text-[9px] text-white">✦</span>
            </div>
            <span className="text-[13px] font-medium text-[var(--ink)]">Чат с ИИ</span>
          </div>
          <div className="flex items-center gap-[4px]">
            {/* Выпадающее меню анализа */}
            {docContent && !generating && (
              <div className="relative">
                <button
                  onClick={() => setAnalysisMenuOpen((v) => !v)}
                  className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                  Анализ
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {analysisMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setAnalysisMenuOpen(false)} />
                    <div className="absolute right-0 top-[30px] z-20 w-[240px] rounded-[var(--radius-lg)] shadow-lg overflow-hidden"
                      style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
                      {([
                        {
                          emoji: '✅',
                          label: 'Проверка документа',
                          prompt: 'Ты — опытный юрист по договорному праву. Твоя задача — провести юридическую проверку предоставленного документа и подготовить отчет для пользователя. Проверь документ по следующим критериям: юридические ошибки и противоречия; отсутствие важных условий и существенных положений; несогласованность пунктов между собой; риски признания отдельных положений недействительными; ошибки в формулировках прав и обязанностей сторон; ошибки в сроках, порядке оплаты, приемке работ, ответственности сторон; ошибки в реквизитах, ссылках на пункты и приложениях; орфографические, грамматические и пунктуационные ошибки; неоднозначные или двусмысленные формулировки. ВАЖНО: Не изменяй текст документа. Не вноси правки автоматически. Только анализируй документ и предоставляй рекомендации. Формат ответа: Общая оценка документа (кратко). Найденные замечания (номер пункта, суть проблемы, возможные последствия, рекомендация). Итоговая оценка качества по шкале от 1 до 10.',
                        },
                        {
                          emoji: '⚠️',
                          label: 'Риски для моей компании',
                          prompt: 'Ты — опытный юрист по договорным рискам. Проведи анализ рисков документа исключительно с точки зрения моей компании (первой стороны договора). Проверь: финансовые риски; риски неоплаты; риски одностороннего расторжения; риски штрафов и неустоек; риски передачи исключительных прав; риски приемки работ и услуг; риски нарушения сроков; риски ответственности без ограничений; риски конфиденциальности; риски форс-мажора; риски отсутствия необходимых условий защиты интересов. ВАЖНО: Не изменяй текст документа. Только выявляй риски и объясняй их последствия. Формат ответа: Общий уровень риска (Низкий / Средний / Высокий / Критический). Для каждого риска: пункт договора, описание, последствия, степень риска, рекомендация. Итоговая оценка защищённости интересов по шкале от 1 до 10.',
                        },
                        {
                          emoji: '⚖️',
                          label: 'Риски для контрагента',
                          prompt: 'Ты — опытный юрист по договорным рискам. Проведи анализ рисков документа исключительно с точки зрения контрагента. Анализируй документ так, как будто именно контрагент подписывает данный документ и стремится максимально защитить свои интересы. Проверь: финансовые риски; риски неоплаты; риски задержки оплаты; риски одностороннего расторжения; риски штрафов и неустоек; риски чрезмерной ответственности; риски передачи исключительных прав; риски приемки работ; риски нарушения сроков; риски конфиденциальности; риски отсутствия необходимых гарантий. ВАЖНО: Не изменяй текст документа. Только выявляй риски и объясняй их последствия. Формат ответа: Общий уровень риска (Низкий / Средний / Высокий / Критический). Для каждого риска: пункт договора, описание, последствия для контрагента, степень риска, рекомендация. Итоговая оценка защищённости интересов контрагента по шкале от 1 до 10.',
                        },
                      ] as { emoji: string; label: string; prompt: string }[]).map((item) => (
                        <button key={item.label}
                          onClick={() => {
                            setInput(item.prompt)
                            setAnalysisMenuOpen(false)
                            setTimeout(() => textareaRef.current?.focus(), 50)
                          }}
                          className="w-full flex items-center gap-[8px] px-[12px] py-[9px] text-[12px] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)] transition-colors cursor-pointer text-left"
                        >
                          <span>{item.emoji}</span>
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {!generating && (
              <button
                onClick={() => router.push(`/documents/${id}/compare`)}
                className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h4"/><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                Сравнить
              </button>
            )}
            {!isPurchased && (
              <button
                onClick={() => setAiSettingsOpen((v) => !v)}
                className="h-[26px] px-[8px] rounded-[var(--radius-md)] text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-[4px]"
                style={aiSettingsOpen
                  ? { background: 'var(--ink)', color: 'var(--bg)' }
                  : { background: 'var(--surface-inset)', color: 'var(--ink-3)' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>
                Настройки ИИ
              </button>
            )}
          </div>
        </div>

        {/* AI-панель настроек */}
        {aiSettingsOpen && !isPurchased && (
          <div className="shrink-0 px-[20px] py-[12px] flex flex-col gap-[12px]"
            style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
            <p className="text-[11px] font-semibold text-[var(--ink-3)] uppercase tracking-[0.06em]">Параметры ИИ</p>

            {/* Уровень защиты */}
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-[var(--ink-2)]">Уровень юридической защиты</label>
                <span className="text-[11px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-mono)' }}>{aiSettingsForm.protectionLevel}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={aiSettingsForm.protectionLevel}
                onChange={(e) => setAiSettingsForm(p => ({ ...p, protectionLevel: Number(e.target.value) }))}
                className="w-full cursor-pointer"
                style={{ accentColor: 'var(--accent)' }}
              />
              <p className="text-[10px] text-[var(--ink-4)]">Мягче (20%) — Сбалансировано (50%) — Жёстче (90%)</p>
            </div>

            {/* Целевой объём */}
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-[var(--ink-2)]">Целевой объём</label>
                <span className="text-[11px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-mono)' }}>{aiSettingsForm.targetSize.toLocaleString('ru-RU')} знаков</span>
              </div>
              <input
                type="range"
                min="500"
                max="50000"
                step="100"
                value={aiSettingsForm.targetSize}
                onChange={(e) => setAiSettingsForm(p => ({ ...p, targetSize: Number(e.target.value) }))}
                className="w-full cursor-pointer"
                style={{ accentColor: 'var(--accent)' }}
              />
              <p className="text-[10px] text-[var(--ink-4)]">≈ {Math.round(aiSettingsForm.targetSize / 1800)} стр. A4 (11pt)</p>
            </div>

            {/* Кнопка применить */}
            <button
              onClick={applyAiSettings}
              disabled={savingSettings || streaming}
              className="w-full h-[32px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed mt-[4px]"
            >
              {savingSettings ? 'Применяю...' : 'Применить'}
            </button>
          </div>
        )}

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
        {!isPurchased && (
          <div className="shrink-0 px-[12px] pb-[8px] flex gap-[6px] flex-wrap">
            {QUICK_CHIPS.map((chip) => (
              <button key={chip} onClick={() => { setInput(chip); textareaRef.current?.focus() }}
                className="px-[10px] h-[26px] rounded-full text-[11px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer whitespace-nowrap">
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Сообщение если версия куплена */}
        {isPurchased && (
          <div className="shrink-0 px-[12px] pb-[12px] flex flex-col gap-[8px]">
            <div className="px-[12px] py-[10px] rounded-[var(--radius-md)] bg-[oklch(0.96_0.01_120)] border border-[oklch(0.87_0.02_130)]">
              <p className="text-[12px] text-[oklch(0.4_0.15_130)] leading-[1.4]">
                ✓ Версия оплачена и готова к скачиванию. Редактирование завершено.
              </p>
            </div>
            <button
              onClick={() => saveAsNewVersion()}
              disabled={saving}
              className="w-full h-[32px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 flex items-center justify-center gap-[6px]"
            >
              {saving ? 'Создаю…' : '✦ Создать новую версию'}
            </button>
          </div>
        )}

        {/* Поле ввода */}
        {!isPurchased && (
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
        )}
      </div>
    </div>
    </>
  )
}
