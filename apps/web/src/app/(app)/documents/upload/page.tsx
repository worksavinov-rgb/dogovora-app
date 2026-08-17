'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DocumentNumberField } from '@/components/document-number-field'
import type { ReviewResult, ExtractPartiesResult, ExtractedParty } from '@/lib/ai/types'

// Ключевые слова блока реквизитов/подписей
const REQUISITES_KEYWORDS_UPLOAD = /\b(ИНН|КПП|ОГРН|ОГРНИП|Р\/счет|р\/сч|БИК|К\/счет|к\/сч|расчётный счет|корр\. счет|e-mail|E-mail|Исполнитель:|Заказчик:)/i

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
    const reqMatchCount = allCells.filter(c => REQUISITES_KEYWORDS_UPLOAD.test(c.textContent ?? '')).length
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

// mammoth.js подгружается динамически только в браузере
// Word → HTML (сохраняем таблицы и форматирование)
async function parseDocxToText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
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
    ]
  })
  return postProcessMammothHtml(result.value)
}

async function parseFileToText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'docx' || ext === 'doc') return parseDocxToText(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string ?? '')
    reader.onerror = reject
    reader.readAsText(file, 'utf-8')
  })
}

type Step = 'upload' | 'analyzing' | 'result'

interface Counterparty { id: string; name: string; inn: string | null }
interface UserProfile { id: string; name: string; inn: string | null }

// ─── Вспомогательные иконки ───────────────────────────────────────────────────

function FileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

// ─── Карточка замечания ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  finance:   '💰 Финансы',
  litigation: '⚖️ Суд',
  abuse:     '🚨 Злоупотребление',
  missing:   '➕ Отсутствует',
  general:   '',
}

const IMPORTANCE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: 'Высокий',  color: 'oklch(0.45 0.16 20)',   bg: 'oklch(0.94 0.03 20)'   },
  medium: { label: 'Средний',  color: 'oklch(0.5 0.1 60)',     bg: 'oklch(0.95 0.02 60)'   },
  low:    { label: 'Низкий',   color: 'var(--ink-4)',           bg: 'var(--surface-inset)'  },
}

function IssueCard({ issue }: { issue: ReviewResult['issues'][0] }) {
  const styles = {
    risk:    { bg: 'oklch(0.97 0.015 20)',  border: 'oklch(0.88 0.04 20)',  dot: 'oklch(0.55 0.18 20)',  label: 'Риск',       labelColor: 'oklch(0.5 0.16 20)'  },
    warning: { bg: 'oklch(0.97 0.015 60)',  border: 'oklch(0.88 0.04 60)',  dot: 'oklch(0.65 0.12 60)',  label: 'Замечание',  labelColor: 'oklch(0.5 0.1 60)'   },
    ok:      { bg: 'oklch(0.97 0.015 145)', border: 'oklch(0.88 0.04 145)', dot: 'oklch(0.55 0.14 145)', label: 'Плюс',       labelColor: 'oklch(0.4 0.12 145)' },
    neutral: { bg: 'var(--surface-inset)',  border: 'var(--line-2)',         dot: 'var(--ink-4)',          label: 'Нейтрально', labelColor: 'var(--ink-4)'        },
  }
  const s = styles[issue.severity] ?? styles.neutral
  const imp = IMPORTANCE_CONFIG[issue.importance ?? 'medium'] ?? IMPORTANCE_CONFIG.medium
  const catLabel = issue.category ? CATEGORY_LABELS[issue.category] : ''

  const recColor = issue.recommendation === 'Оставить' || issue.recommendation === 'Усилить'
    ? 'oklch(0.4 0.12 145)'
    : issue.recommendation === 'Исправить' || issue.recommendation === 'Добавить'
    ? 'oklch(0.5 0.16 20)'
    : 'var(--ink-4)'
  const recBg = issue.recommendation === 'Оставить' || issue.recommendation === 'Усилить'
    ? 'oklch(0.93 0.03 145)'
    : issue.recommendation === 'Исправить' || issue.recommendation === 'Добавить'
    ? 'oklch(0.92 0.03 20)'
    : 'var(--line)'

  return (
    <div className="rounded-[var(--radius-md)] p-[14px]" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
      <div className="flex items-start gap-[10px]">
        <div className="w-[6px] h-[6px] rounded-full mt-[5px] shrink-0" style={{ background: s.dot }} />
        <div className="flex-1 min-w-0">
          {/* Строка 1: тип + категория + пункт */}
          <div className="flex items-center gap-[6px] mb-[3px] flex-wrap">
            <span className="text-[10px] font-semibold px-[6px] py-[1px] rounded-full" style={{ background: s.border, color: s.labelColor }}>{s.label}</span>
            {catLabel && (
              <span className="text-[10px] px-[6px] py-[1px] rounded-full" style={{ background: 'var(--surface-inset)', color: 'var(--ink-3)', border: '1px solid var(--line-2)' }}>{catLabel}</span>
            )}
            {/* Значимость — показываем только высокий и средний */}
            {issue.importance && issue.importance !== 'low' && (
              <span className="text-[10px] font-medium px-[6px] py-[1px] rounded-full" style={{ background: imp.bg, color: imp.color }}>{imp.label}</span>
            )}
            {issue.clause && issue.clause !== 'нет' && (
              <span className="text-[11px] text-[var(--ink-4)] ml-auto" style={{ fontFamily: 'var(--font-mono)' }}>{issue.clause}</span>
            )}
          </div>
          {/* Строка 2: заголовок */}
          <p className="text-[13px] font-medium text-[var(--ink)] mb-[4px]">{issue.title}</p>
          {/* Строка 3: описание */}
          <p className="text-[12px] text-[var(--ink-3)] leading-relaxed mb-[6px]">{issue.description}</p>
          {/* Строка 4: рекомендация */}
          {issue.recommendation && (
            <span className="text-[10px] font-semibold px-[6px] py-[1px] rounded-full" style={{ background: recBg, color: recColor }}>
              → {issue.recommendation}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Строка реквизита ─────────────────────────────────────────────────────────

function ReqRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex gap-[8px] text-[12px]">
      <span className="shrink-0 text-[var(--ink-4)] w-[110px]">{label}</span>
      <span className="text-[var(--ink-2)] font-medium" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{value}</span>
    </div>
  )
}

// ─── Карточка найденной стороны ───────────────────────────────────────────────

function PartyCard({
  party, label, isMe, existingCounterparties, onSave, onSkip, onMatchExisting,
}: {
  party: ExtractedParty
  label: string
  isMe: boolean
  existingCounterparties: Counterparty[]
  onSave: (party: ExtractedParty) => Promise<void>
  onSkip: () => void
  onMatchExisting: (id: string) => void
}) {
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSave(party)
    setSaving(false)
  }

  // Сравниваем только по ИНН (убираем нецифры на случай пробелов/дефисов)
  const inn = party.inn?.replace(/\D/g, '')
  const alreadyExists = inn
    ? existingCounterparties.find((c) => c.inn?.replace(/\D/g, '') === inn)
    : null

  if (isMe) {
    return (
      <div className="rounded-[var(--radius-md)] p-[14px]" style={{ background: 'oklch(0.96 0.015 260)', border: '1px solid oklch(0.88 0.03 260)' }}>
        <div className="flex items-center gap-[8px] mb-[8px]">
          <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: 'var(--accent)' }}>Я</div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--accent)' }}>{label} — это вы</p>
        </div>
        <p className="text-[13px] font-medium text-[var(--ink)]">{party.name}</p>
        {party.inn && <p className="text-[11px] text-[var(--ink-4)] mt-[2px]" style={{ fontFamily: 'var(--font-mono)' }}>ИНН {party.inn}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-[var(--radius-md)] p-[16px]" style={{ background: '#ffffff', border: '1px solid var(--line-2)' }}>
      {/* Шапка */}
      <div className="flex items-center justify-between mb-[10px]">
        <div className="flex items-center gap-[8px]">
          <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[10px] font-bold text-[var(--ink-3)] shrink-0" style={{ background: 'var(--surface-inset)' }}>К</div>
          <p className="text-[11px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em]">{label} — контрагент</p>
        </div>
        {alreadyExists && (
          <span className="text-[10px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.93 0.03 145)', color: 'oklch(0.4 0.12 145)' }}>
            Уже в системе
          </span>
        )}
      </div>

      <p className="text-[14px] font-medium text-[var(--ink)] mb-[10px]">{party.name}</p>

      <div className="flex flex-col gap-[4px] mb-[14px]">
        <ReqRow label="ИНН" value={party.inn} />
        <ReqRow label="КПП" value={party.kpp} />
        <ReqRow label="ОГРН" value={party.ogrn} />
        <ReqRow label="Адрес" value={party.legalAddress} />
        <ReqRow label="Банк" value={party.bankName} />
        <ReqRow label="БИК" value={party.bik} />
        <ReqRow label="Р/счёт" value={party.checkingAccount} />
        <ReqRow label="К/счёт" value={party.correspondentAccount} />
        <ReqRow label="Подписант" value={party.signatorName} />
        <ReqRow label="Должность" value={party.signatorPosition} />
        <ReqRow label="Основание" value={party.signatorBasis} />
      </div>

      {/* Действия */}
      {alreadyExists ? (
        // Найден по ИНН — автоматически привязываем, показываем инфо
        <div className="flex items-center gap-[8px] p-[10px] rounded-[var(--radius-md)]"
          style={{ background: 'oklch(0.96 0.015 145)', border: '1px solid oklch(0.88 0.04 145)' }}>
          <div style={{ color: 'oklch(0.45 0.14 145)', flexShrink: 0 }}><CheckIcon /></div>
          <p className="text-[12px] flex-1" style={{ color: 'oklch(0.4 0.12 145)' }}>
            Найден в системе по ИНН: <strong>{alreadyExists.name}</strong>
          </p>
          <button onClick={() => onMatchExisting(alreadyExists.id)}
            className="shrink-0 text-[11px] font-medium cursor-pointer px-[8px] py-[3px] rounded-[var(--radius-sm)] transition-colors"
            style={{ background: 'oklch(0.88 0.04 145)', color: 'oklch(0.4 0.12 145)' }}>
            Использовать
          </button>
        </div>
      ) : (
        // Не найден — предлагаем создать или пропустить
        <div className="flex gap-[8px]">
          <Button variant="ghost" size="sm" onClick={onSkip} className="flex-1">Пропустить</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Сохраняю…' : '+ Сохранить контрагента'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [role, setRole] = useState<'customer' | 'executor'>('customer')
  const [roleLabel, setRoleLabel] = useState('Заказчик')
  const [consentPii, setConsentPii] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docText, setDocText] = useState('')
  const [analysisProgress, setAnalysisProgress] = useState('Подготовка…')

  // Результаты анализа
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [parties, setParties] = useState<ExtractPartiesResult | null>(null)
  const [existingCounterparties, setExistingCounterparties] = useState<Counterparty[]>([])
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([])
  // myPartyIndex: 1 = party1 это я, 2 = party2 это я (определяется по ИНН профилей)
  const [myPartyIndex, setMyPartyIndex] = useState<1 | 2>(1)

  // Определённый контрагент (после сохранения/выбора)
  const [resolvedCounterpartyId, setResolvedCounterpartyId] = useState<string | null>(null)
  const [counterpartySaved, setCounterpartySaved] = useState(false)

  // Мои реквизиты: сохранены ли из документа
  const [myProfileSaved, setMyProfileSaved] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  // «Моё» юрлицо для этого документа: определяется по ИНН, сохраняется из
  // документа или выбирается вручную в модалке. От него зависит нумерация.
  const [myProfileId, setMyProfileId] = useState<string | null>(null)

  // Модалка создания документа
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [docType, setDocType] = useState<'CONTRACT' | 'APPENDIX' | 'AMENDMENT'>('CONTRACT')
  const [saving, setSaving] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    const allowed = ['docx', 'doc', 'txt']
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!allowed.includes(ext)) { setError('Поддерживаются файлы: DOCX, DOC, TXT'); return }
    setFile(f)
    setError(null)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const analyze = async () => {
    if (!file) return
    setStep('analyzing')
    setError(null)

    try {
      const text = await parseFileToText(file)
      setDocText(text)

      // Для анализа ИИ извлекаем plain text (без HTML-тегов)
      const isHtmlContent = /<[a-z][\s\S]*>/i.test(text.slice(0, 1000))
      const textForAnalysis = isHtmlContent
        ? (() => {
            const tmp = document.createElement('div')
            tmp.innerHTML = text
            return tmp.textContent ?? tmp.innerText ?? text
          })()
        : text

      // Анализ через SSE — сервер держит соединение живым и присылает прогресс
      const reviewData = await new Promise<ReviewResult>((resolve, reject) => {
        fetch('/api/documents/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textForAnalysis, role, roleLabel }),
        }).then(async (res) => {
          if (!res.ok || !res.body) {
            const err = await res.json().catch(() => ({})) as { error?: string }
            reject(new Error(err.error ?? 'Ошибка анализа'))
            return
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const evt = JSON.parse(line.slice(6)) as { type: string; message?: string } & ReviewResult
                if (evt.type === 'progress') setAnalysisProgress(evt.message ?? '…')
                else if (evt.type === 'result') resolve(evt as unknown as ReviewResult)
                else if (evt.type === 'error') reject(new Error(evt.message ?? 'Ошибка анализа'))
              } catch { /* skip malformed */ }
            }
          }
        }).catch(reject)
      })
      setResult(reviewData)

      // Параллельно (необязательно — не ломают процесс при ошибке):
      // извлечение реквизитов (только с согласием на ПДн) + контрагенты + профили
      const [partiesData, cpData, profilesData] = await Promise.all([
        consentPii
          ? fetch('/api/documents/extract-parties', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: textForAnalysis, consentPii: true }),
            }).then(async (r) => {
              if (!r.ok) return null
              return r.json().catch(() => null) as Promise<ExtractPartiesResult | null>
            }).catch(() => null)
          : Promise.resolve(null),

        fetch('/api/counterparties').then(async (r) => {
          if (!r.ok) return []
          return r.json().catch(() => []) as Promise<Counterparty[]>
        }).catch(() => []),

        fetch('/api/profiles').then(async (r) => {
          if (!r.ok) return []
          return r.json().catch(() => []) as Promise<UserProfile[]>
        }).catch(() => []),
      ])

      setParties(partiesData)
      setExistingCounterparties(cpData)
      setUserProfiles(profilesData)

      // Предзаполняем название
      if (partiesData?.docTitle) setDocTitle(partiesData.docTitle)
      else setDocTitle(file.name.replace(/\.(docx|doc|txt)$/i, ''))

      // Определяем кто "я" — три уровня приоритета:
      // 1. Совпадение ИНН с профилями пользователя (самый точный)
      // 2. Совпадение роли из документа с выбранной пользователем ролью
      // 3. По умолчанию party1 = я
      const cleanInn = (s: string | null | undefined) => s?.replace(/\D/g, '') ?? ''

      let meIndex: 1 | 2 = 1
      if (partiesData) {
        // Пользователь сам сказал кто он — доверяем его выбору
        if (partiesData.party2?.role === role) {
          meIndex = 2
        } else if (partiesData.party1?.role === role) {
          meIndex = 1
        }
        // Если ИИ не смог определить роли — party1 по умолчанию
      }
      setMyPartyIndex(meIndex)

      // Определяем «моё» юрлицо среди сохранённых профилей: сначала по ИНН из
      // документа, иначе — единственный профиль пользователя. Без него документ
      // не к чему привязать и нечем нумеровать; если не вышло — выбор в модалке.
      const myPartyData = meIndex === 1 ? partiesData?.party1 : partiesData?.party2
      const myInn = cleanInn(myPartyData?.inn)
      const matchedProfile = myInn
        ? profilesData.find((p) => cleanInn(p.inn) === myInn)
        : undefined
      setMyProfileId(matchedProfile?.id ?? (profilesData.length === 1 ? profilesData[0].id : null))

      // Автоматически определяем контрагента по ИНН в списке контрагентов
      const counterpartyPartyData = meIndex === 1 ? partiesData?.party2 : partiesData?.party1
      if (counterpartyPartyData?.inn) {
        const inn = cleanInn(counterpartyPartyData.inn)
        const found = cpData.find((c) => cleanInn(c.inn) === inn)
        if (found) {
          // Автоматически привязываем ID, но не показываем баннер —
          // карточка «Найден в системе по ИНН» уже достаточная обратная связь
          setResolvedCounterpartyId(found.id)
        }
      }

      setStep('result')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось проанализировать документ'
      setError(msg + '. Попробуйте ещё раз.')
      setStep('upload')
    }
  }

  // Определяем какая из сторон — пользователь, какая — контрагент
  // myPartyIndex устанавливается в analyze() на основе сравнения ИНН с профилями
  const myParty = myPartyIndex === 1 ? parties?.party1 : parties?.party2
  const counterpartyParty = myPartyIndex === 1 ? parties?.party2 : parties?.party1
  const counterpartyLabel = myPartyIndex === 1 ? 'Сторона 2' : 'Сторона 1'

  const saveCounterparty = async (party: ExtractedParty) => {
    // Определяем basisType из строки
    const basis = party.signatorBasis?.toLowerCase() ?? ''
    const basisType = basis.includes('доверенност') ? 'POA'
      : basis.includes('свидетельств') ? 'CERTIFICATE'
      : basis.includes('положени') ? 'REGULATION'
      : basis.includes('устав') ? 'CHARTER'
      : 'OTHER'

    const res = await fetch('/api/counterparties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: party.name,
        inn: party.inn || undefined,
        kpp: party.kpp || undefined,
        ogrn: party.ogrn || undefined,
        legalAddress: party.legalAddress || undefined,
        orgForm: party.type || undefined,
        bankName: party.bankName || undefined,
        bik: party.bik || undefined,
        checkingAccount: party.checkingAccount || undefined,
        correspondentAccount: party.correspondentAccount || undefined,
        ...(party.signatorName ? {
          signatory: {
            fullName: party.signatorName,
            position: party.signatorPosition || '',
            basisType,
          },
        } : {}),
      }),
    })

    if (res.ok) {
      const cp = await res.json() as { id: string }
      setResolvedCounterpartyId(cp.id)
      setCounterpartySaved(true)
    }
  }

  // Сохраняем данные «моей стороны» в профили пользователя
  const saveMyProfile = async (party: ExtractedParty) => {
    setSavingProfile(true)
    try {
      // Определяем тип организации из строки
      const t = party.type?.toUpperCase() ?? ''
      const profileType = t.includes('ИП') || t.includes('ПРЕДПРИНИМА') ? 'SOLE_PROPRIETOR'
        : t.includes('ООО') || t.includes('ОБЩЕСТВО') ? 'COMPANY'
        : t.includes('АО') || t.includes('АКЦИОНЕР') ? 'COMPANY'
        : t.includes('АНО') ? 'ANO'
        : party.inn?.length === 12 ? 'SOLE_PROPRIETOR'  // ИНН физлица/ИП — 12 цифр
        : 'COMPANY'

      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: profileType,
          name: party.name,
          inn: party.inn || undefined,
          kpp: party.kpp || undefined,
          ogrn: party.ogrn || undefined,
          legalAddress: party.legalAddress || undefined,
          signatorName: party.signatorName || undefined,
          signatorPosition: party.signatorPosition || undefined,
          signatorBasis: party.signatorBasis || undefined,
          bankName: party.bankName || undefined,
          bik: party.bik || undefined,
          checkingAccount: party.checkingAccount || undefined,
          correspondentAccount: party.correspondentAccount || undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json() as UserProfile
        setUserProfiles((prev) => [...prev, created])
        setMyProfileSaved(true)
        // Только что созданный профиль и есть «моё» юрлицо для этого документа
        setMyProfileId(created.id)
      }
    } finally {
      setSavingProfile(false)
    }
  }

  const createAndOpen = async () => {
    if (!docTitle.trim()) return
    // Если контрагент не определён — нужен выбор
    if (!resolvedCounterpartyId) {
      setError('Выберите или создайте контрагента')
      return
    }
    setSaving(true)

    try {
      const docRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: docTitle.trim(),
          number: docNumber.trim() || undefined,
          type: docType,
          counterpartyId: resolvedCounterpartyId,
          // Раньше profileId с этого экрана не уходил вовсе, и загруженные
          // документы оставались без юрлица — а без него нечем считать
          // сквозную нумерацию договоров и нечего подставлять в шапку.
          profileId: myProfileId ?? undefined,
          uploadedContent: docText,
          aiSettings: {
            protectionLevel: role === 'executor' ? 60 : 70,
            targetSize: 8400,
            customInstruction: `Пользователь является ${role === 'executor' ? 'исполнителем' : 'заказчиком'}. Защищай его интересы при редактировании.`,
            base: 'upload',
            description: '',
          },
        }),
      })
      if (!docRes.ok) {
        const body = await docRes.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Ошибка ${docRes.status}`)
      }
      const contentType = docRes.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error('Сессия истекла — обновите страницу и войдите снова')
      }
      const doc = await docRes.json() as { id: string }
      router.push(`/documents/${doc.id}/work`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать документ')
      setSaving(false)
    }
  }

  const openSaveModal = async () => {
    // Если контрагент ещё не выбран — нужен выбор из списка
    if (!resolvedCounterpartyId && existingCounterparties.length > 0) {
      setShowSaveModal(true)
    } else {
      setShowSaveModal(true)
    }
  }

  const scoreColor = (s: number) => s >= 70 ? 'oklch(0.5 0.14 145)' : s >= 45 ? 'oklch(0.55 0.12 60)' : 'oklch(0.55 0.18 20)'
  const scoreLabel = (s: number) => s >= 70 ? 'Хороший документ' : s >= 45 ? 'Есть замечания' : 'Требует доработки'

  return (
    <div className="max-w-[720px]">

      {/* Шапка */}
      <div className="mb-[28px]">
        <button onClick={() => router.back()} className="flex items-center gap-[6px] text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors mb-[16px] cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Назад
        </button>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, marginBottom: 6 }}>
          {step === 'result' ? 'Анализ документа' : 'Загрузить документ'}
        </h1>
        <p className="text-[14px] text-[var(--ink-3)]">
          {step === 'result'
            ? 'Догодок проверил документ и распознал стороны. Сохраните реквизиты и перейдите к редактированию.'
            : 'Догодок проверит документ и распознает реквизиты сторон для автоматического сохранения.'}
        </p>
      </div>

      {/* ─── Шаг 1: Загрузка ──────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-[20px]">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="rounded-[var(--radius-lg)] border-2 border-dashed flex flex-col items-center justify-center gap-[12px] py-[48px] px-[24px] cursor-pointer transition-colors"
            style={{ borderColor: dragging ? 'var(--accent)' : file ? 'oklch(0.55 0.14 145)' : 'var(--line-2)', background: dragging ? 'oklch(0.97 0.01 260)' : file ? 'oklch(0.97 0.015 145)' : 'var(--surface)' }}
          >
            <input ref={inputRef} type="file" accept=".docx,.doc,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <div className="w-[56px] h-[56px] rounded-full flex items-center justify-center" style={{ background: file ? 'oklch(0.88 0.04 145)' : 'var(--surface-inset)', color: file ? 'oklch(0.45 0.14 145)' : 'var(--ink-4)' }}>
              {file ? <FileIcon /> : <UploadIcon />}
            </div>
            {file ? (
              <><p className="text-[14px] font-medium text-[var(--ink)]">{file.name}</p><p className="text-[12px] text-[var(--ink-4)]">{(file.size / 1024).toFixed(0)} КБ — нажмите чтобы заменить</p></>
            ) : (
              <><p className="text-[14px] font-medium text-[var(--ink)]">Перетащите файл или нажмите</p><p className="text-[12px] text-[var(--ink-4)]">Поддерживаются DOCX, DOC, TXT</p></>
            )}
          </div>

          <div className="rounded-[var(--radius-lg)] p-[20px]" style={{ background: '#ffffff', border: '1px solid var(--line-2)' }}>
            <p className="text-[12px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[14px]">Кто вы в этом договоре?</p>
            <div className="grid grid-cols-2 gap-[10px]">
              {([
                { label: 'Заказчик',    sub: 'Вы заказываете услугу или работу', r: 'customer' as const },
                { label: 'Исполнитель', sub: 'Вы выполняете услугу или работу',  r: 'executor' as const },
              ]).map(({ label, sub, r }) => (
                <button
                  key={label}
                  onClick={() => { setRole(r); setRoleLabel(label) }}
                  className="rounded-[var(--radius-md)] p-[14px] text-left transition-all cursor-pointer"
                  style={{
                    border: `2px solid ${roleLabel === label ? 'var(--accent)' : 'var(--line-2)'}`,
                    background: roleLabel === label ? 'oklch(0.96 0.015 260)' : 'var(--surface-inset)',
                  }}
                >
                  <p className="text-[14px] font-medium text-[var(--ink)] mb-[2px]">{label}</p>
                  <p className="text-[11px] text-[var(--ink-4)]">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-[10px] rounded-[var(--radius-md)] p-[14px] cursor-pointer" style={{ background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
            <input
              type="checkbox"
              className="mt-[3px] shrink-0"
              checked={consentPii}
              onChange={(e) => setConsentPii(e.target.checked)}
            />
            <span className="text-[13px] text-[var(--ink-2)] leading-snug">
              Разрешаю отправить текст договора в ИИ для <strong>извлечения реквизитов сторон</strong>
              (ИНН, названия, адреса). Без согласия проверка рисков всё равно выполнится, но реквизиты нужно будет ввести вручную.
            </span>
          </label>

          {error && <p className="text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p>}

          <Button variant="primary" size="lg" disabled={!file} onClick={analyze} className="w-full">
            Анализировать документ
          </Button>
        </div>
      )}

      {/* ─── Шаг 2: Анализ ────────────────────────────────────────────────────── */}
      {step === 'analyzing' && (
        <div className="rounded-[var(--radius-lg)] p-[48px] flex flex-col items-center gap-[16px]" style={{ background: '#ffffff', border: '1px solid var(--line-2)' }}>
          <div className="w-[48px] h-[48px] rounded-full border-[3px] animate-spin" style={{ borderColor: 'var(--line-2)', borderTopColor: 'var(--accent)' }} />
          <p className="text-[14px] text-[var(--ink)] font-medium">Догодок анализирует документ…</p>
          <p className="text-[12px] text-[var(--ink-4)]">{analysisProgress}</p>
          <p className="text-[11px] text-[var(--ink-4)] opacity-60">Большие документы — до 60 секунд</p>
        </div>
      )}

      {/* ─── Шаг 3: Результат ─────────────────────────────────────────────────── */}
      {step === 'result' && result && (
        <div className="flex flex-col gap-[16px]">

          {/* Оценка */}
          <div className="rounded-[var(--radius-lg)] p-[20px]" style={{ background: '#ffffff', border: '1px solid var(--line-2)' }}>
            <div className="flex items-center gap-[20px]">
              <div className="w-[80px] h-[80px] rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface-inset)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: scoreColor(result.score) }}>
                  <span style={{ fontSize: 22 }}>{result.score}</span><span style={{ fontSize: 12, color: 'var(--ink-4)' }}>/100</span>
                </span>
              </div>
              <div>
                <p className="text-[16px] font-medium text-[var(--ink)] mb-[4px]">{scoreLabel(result.score)}</p>
                <p className="text-[13px] text-[var(--ink-3)] leading-relaxed">{result.summary}</p>
                <div className="flex gap-[10px] mt-[10px] flex-wrap">
                  {result.riskCount > 0 && <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.92 0.03 20)', color: 'oklch(0.5 0.16 20)' }}>{result.riskCount} риск{result.riskCount === 1 ? '' : 'а'}</span>}
                  {result.warningCount > 0 && <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.93 0.03 60)', color: 'oklch(0.5 0.1 60)' }}>{result.warningCount} замечани{result.warningCount === 1 ? 'е' : 'я'}</span>}
                  {result.okCount > 0 && <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.93 0.03 145)', color: 'oklch(0.4 0.12 145)' }}>{result.okCount} плюс{result.okCount === 1 ? '' : 'а'}</span>}
                  {result.spellCount > 0 && <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'var(--surface-inset)', color: 'var(--ink-3)', border: '1px solid var(--line-2)' }}>{result.spellCount} орф. ошибк{result.spellCount === 1 ? 'а' : result.spellCount < 5 ? 'и' : ''}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Роль */}
          <div className="rounded-[var(--radius-md)] px-[14px] py-[10px] flex items-center gap-[8px]" style={{ background: 'oklch(0.96 0.015 260)', border: '1px solid oklch(0.88 0.03 260)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(0.42 0.06 260)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p className="text-[12px]" style={{ color: 'oklch(0.35 0.06 260)' }}>Анализ выполнен с позиции <strong>{roleLabel}</strong></p>
          </div>

          {/* ─── Распознанные стороны ──────────────────────────────────────────── */}
          {parties && (
            <div>
              <p className="text-[11px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em] px-[2px] mb-[10px]">
                Распознанные стороны
              </p>
              <div className="flex flex-col gap-[10px]">
                {/* Моя сторона */}
                {myParty && (
                  <div className="flex flex-col gap-[8px]">
                    <PartyCard
                      party={myParty}
                      label={myPartyIndex === 1 ? 'Сторона 1' : 'Сторона 2'}
                      isMe={true}
                      existingCounterparties={existingCounterparties}
                      onSave={async () => {}}
                      onSkip={() => {}}
                      onMatchExisting={() => {}}
                    />
                    {/* Предложение сохранить в «Мои реквизиты» если профилей нет */}
                    {userProfiles.length === 0 && !myProfileSaved && (
                      <div className="rounded-[var(--radius-md)] px-[14px] py-[12px] flex items-center gap-[10px]"
                        style={{ background: 'oklch(0.97 0.015 60)', border: '1px solid oklch(0.88 0.04 60)' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="oklch(0.5 0.1 60)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <div className="flex-1">
                          <p className="text-[12px] font-medium" style={{ color: 'oklch(0.45 0.1 60)' }}>
                            Ваши реквизиты не заполнены
                          </p>
                          <p className="text-[11px]" style={{ color: 'oklch(0.55 0.08 60)' }}>
                            Сохраните данные из договора — они нужны для шапки и подписи документа
                          </p>
                        </div>
                        <button
                          onClick={() => saveMyProfile(myParty)}
                          disabled={savingProfile}
                          className="shrink-0 h-[30px] px-[12px] rounded-[var(--radius-md)] text-[11px] font-semibold transition-opacity cursor-pointer disabled:opacity-50"
                          style={{ background: 'oklch(0.5 0.1 60)', color: '#fff' }}
                        >
                          {savingProfile ? 'Сохраняю…' : 'Сохранить →'}
                        </button>
                      </div>
                    )}
                    {/* Подтверждение сохранения */}
                    {myProfileSaved && (
                      <div className="rounded-[var(--radius-md)] px-[14px] py-[10px] flex items-center gap-[8px]"
                        style={{ background: 'oklch(0.96 0.015 145)', border: '1px solid oklch(0.88 0.04 145)' }}>
                        <div style={{ color: 'oklch(0.45 0.14 145)' }}><CheckIcon /></div>
                        <p className="text-[12px]" style={{ color: 'oklch(0.4 0.12 145)' }}>
                          Ваши реквизиты сохранены в <strong>Мои реквизиты</strong>
                        </p>
                        <button onClick={() => router.push('/profile/requisites')} className="ml-auto text-[11px] cursor-pointer underline" style={{ color: 'oklch(0.4 0.12 145)' }}>
                          Проверить →
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* Контрагент */}
                {counterpartyParty && (
                  <PartyCard
                    party={counterpartyParty}
                    label={counterpartyLabel}
                    isMe={false}
                    existingCounterparties={existingCounterparties}
                    onSave={saveCounterparty}
                    onSkip={() => setCounterpartySaved(true)}
                    onMatchExisting={(id) => { setResolvedCounterpartyId(id); setCounterpartySaved(true) }}
                  />
                )}
              </div>

              {/* Статус готовности контрагента */}
              {counterpartySaved && resolvedCounterpartyId && (
                <div className="mt-[10px] rounded-[var(--radius-md)] px-[14px] py-[10px] flex items-center gap-[8px]"
                  style={{ background: 'oklch(0.96 0.015 145)', border: '1px solid oklch(0.88 0.04 145)' }}>
                  <div style={{ color: 'oklch(0.45 0.14 145)' }}><CheckIcon /></div>
                  <p className="text-[12px]" style={{ color: 'oklch(0.4 0.12 145)' }}>Контрагент сохранён — можно открывать документ</p>
                </div>
              )}
            </div>
          )}

          {/* Замечания */}
          <div className="flex flex-col gap-[8px]">
            <p className="text-[11px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em] px-[2px]">
              Замечания ({result.issues.length})
            </p>
            {result.issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>

          {/* Кнопки */}
          <div className="flex gap-[10px] pt-[4px]">
            <Button variant="ghost" size="md" onClick={() => { setStep('upload'); setResult(null); setParties(null); setMyPartyIndex(1); setResolvedCounterpartyId(null); setCounterpartySaved(false); setMyProfileId(null); setDocNumber('') }}>
              ← Загрузить другой
            </Button>
            <Button variant="primary" size="md" onClick={openSaveModal} className="flex-1">
              Редактировать документ →
            </Button>
          </div>
        </div>
      )}

      {/* ─── Модалка: заполнить карточку документа ────────────────────────────── */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-[16px]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={(e) => { if (e.target === e.currentTarget) setShowSaveModal(false) }}>
          <div className="w-full max-w-[460px] rounded-[var(--radius-xl)] p-[28px]" style={{ background: '#ffffff', border: '1px solid var(--line-2)', boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, marginBottom: 6 }}>Открыть в редакторе</h2>
            <p className="text-[13px] text-[var(--ink-3)] mb-[20px]">Уточните детали документа — он появится в архиве с историей версий.</p>

            <div className="flex flex-col gap-[14px]">
              <div>
                <label className="block text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[6px]">Название документа</label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Договор оказания услуг…"
                  className="w-full h-[38px] px-[12px] text-[14px] rounded-[var(--radius-md)] border border-[var(--line-2)] focus:border-[var(--accent)] outline-none transition-colors"
                  style={{ background: 'var(--surface)' }}
                />
              </div>

              {/* Своё юрлицо: к нему привязывается документ и от него считается
                  нумерация. Определяется по ИНН из документа, но если не вышло —
                  выбираем руками, иначе номер предложить не из чего. */}
              {userProfiles.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[6px]">Ваше юрлицо</label>
                  <select
                    value={myProfileId ?? ''}
                    onChange={(e) => setMyProfileId(e.target.value || null)}
                    className="w-full h-[38px] px-[12px] text-[14px] rounded-[var(--radius-md)] border border-[var(--line-2)] outline-none cursor-pointer"
                    style={{ background: 'var(--surface)' }}
                  >
                    <option value="">Не выбрано</option>
                    {userProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.inn ? ` (ИНН ${p.inn})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Номер из текста файла намеренно не извлекаем: либо следующий по
                  порядку, либо номер с бумажного оригинала — решает пользователь */}
              <DocumentNumberField
                profileId={myProfileId}
                value={docNumber}
                onChange={setDocNumber}
                label="Номер договора"
              />

              <div>
                <label className="block text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[6px]">Тип документа</label>
                <div className="grid grid-cols-3 gap-[8px]">
                  {(['CONTRACT', 'APPENDIX', 'AMENDMENT'] as const).map((t) => (
                    <button key={t} onClick={() => setDocType(t)} className="h-[36px] rounded-[var(--radius-md)] text-[12px] font-medium transition-all cursor-pointer"
                      style={{ border: `1.5px solid ${docType === t ? 'var(--accent)' : 'var(--line-2)'}`, background: docType === t ? 'oklch(0.96 0.015 260)' : 'var(--surface-inset)', color: docType === t ? 'var(--accent)' : 'var(--ink-3)' }}>
                      {t === 'CONTRACT' ? 'Договор' : t === 'APPENDIX' ? 'Приложение' : 'Доп. соглаш.'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Контрагент */}
              {resolvedCounterpartyId ? (
                <div className="rounded-[var(--radius-md)] p-[12px] flex items-center gap-[8px]" style={{ background: 'oklch(0.96 0.015 145)', border: '1px solid oklch(0.88 0.04 145)' }}>
                  <div style={{ color: 'oklch(0.45 0.14 145)' }}><CheckIcon /></div>
                  <p className="text-[12px]" style={{ color: 'oklch(0.4 0.12 145)' }}>
                    Контрагент уже выбран
                  </p>
                  <button onClick={() => { setResolvedCounterpartyId(null); setCounterpartySaved(false) }} className="ml-auto text-[11px] cursor-pointer" style={{ color: 'var(--ink-4)' }}>
                    Изменить
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[6px]">Контрагент</label>
                  {existingCounterparties.length === 0 ? (
                    <div className="rounded-[var(--radius-md)] p-[12px] text-center" style={{ background: 'var(--surface-inset)', border: '1px solid var(--line)' }}>
                      <p className="text-[12px] text-[var(--ink-4)] mb-[8px]">Нет сохранённых контрагентов</p>
                      <button onClick={() => { setShowSaveModal(false); router.push('/counterparties/new') }} className="text-[12px] font-medium cursor-pointer" style={{ color: 'var(--accent)' }}>+ Добавить контрагента →</button>
                    </div>
                  ) : (
                    <select
                      onChange={(e) => setResolvedCounterpartyId(e.target.value)}
                      className="w-full h-[38px] px-[12px] text-[14px] rounded-[var(--radius-md)] border border-[var(--line-2)] outline-none cursor-pointer"
                      style={{ background: 'var(--surface)' }}
                    >
                      <option value="">Выберите контрагента…</option>
                      {existingCounterparties.map((cp) => (
                        <option key={cp.id} value={cp.id}>{cp.name}{cp.inn ? ` (ИНН ${cp.inn})` : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Предупреждение если нет профиля — реквизиты будут пустыми */}
            {userProfiles.length === 0 && !myProfileSaved && (
              <div className="mt-[14px] rounded-[var(--radius-md)] px-[12px] py-[10px] flex items-start gap-[8px]"
                style={{ background: 'oklch(0.97 0.015 60)', border: '1px solid oklch(0.88 0.04 60)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(0.5 0.1 60)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-[1px] shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>
                  <p className="text-[12px] font-medium" style={{ color: 'oklch(0.45 0.1 60)' }}>
                    Ваши реквизиты не заполнены
                  </p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'oklch(0.55 0.08 60)' }}>
                    В шапке и подписи документа будут пропуски.{' '}
                    <button onClick={() => { setShowSaveModal(false); router.push('/profile/requisites') }} className="underline cursor-pointer font-medium">
                      Заполнить сейчас →
                    </button>
                  </p>
                </div>
              </div>
            )}

            {error && <p className="text-[12px] mt-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}

            <div className="flex gap-[10px] mt-[24px]">
              <Button variant="ghost" size="md" onClick={() => setShowSaveModal(false)} disabled={saving}>Отмена</Button>
              <Button variant="primary" size="md" onClick={createAndOpen} disabled={!resolvedCounterpartyId || !docTitle.trim() || saving} className="flex-1">
                {saving ? 'Создаём…' : 'Открыть в редакторе →'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
