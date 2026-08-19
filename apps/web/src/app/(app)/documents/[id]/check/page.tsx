'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { htmlToPlainText, isHtmlString } from '@/lib/html-to-text'
import { formatTokens } from '@/lib/token-pricing'

interface ReviewIssue {
  id: string
  severity: 'risk' | 'warning' | 'ok' | 'neutral'
  importance?: 'high' | 'medium' | 'low'
  title: string
  description: string
  clause: string
  recommendation?: string
  category?: string
}

interface ReviewResult {
  score: number
  riskCount: number
  warningCount: number
  okCount: number
  spellCount?: number
  issues: ReviewIssue[]
  summary: string
}

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  risk:    { color: 'var(--danger)',      bg: 'oklch(0.97 0.015 20)',  label: 'Риск',       icon: '✕' },
  warning: { color: 'oklch(0.6 0.1 60)', bg: 'oklch(0.97 0.015 60)',  label: 'Внимание',   icon: '!' },
  ok:      { color: 'oklch(0.5 0.1 145)', bg: 'oklch(0.97 0.015 145)', label: 'OK',        icon: '✓' },
  neutral: { color: 'var(--ink-4)',       bg: 'var(--surface-inset)',  label: 'Нейтрально', icon: '·' },
}

const CATEGORY_LABELS: Record<string, string> = {
  finance:    '💰 Финансы',
  litigation: '⚖️ Суд',
  abuse:      '🚨 Злоупотребление',
  missing:    '➕ Отсутствует',
}

const IMPORTANCE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: 'Высокий', color: 'oklch(0.45 0.16 20)',  bg: 'oklch(0.94 0.03 20)'  },
  medium: { label: 'Средний', color: 'oklch(0.5 0.1 60)',    bg: 'oklch(0.95 0.02 60)'  },
  low:    { label: 'Низкий',  color: 'var(--ink-4)',          bg: 'var(--surface-inset)' },
}

function ScoreRing({ score }: { score: number }) {
  const r = 42
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ
  const color = score >= 80 ? 'oklch(0.5 0.1 145)' : score >= 60 ? 'oklch(0.6 0.1 60)' : 'var(--danger)'

  return (
    <div className="relative w-[100px] h-[100px]">
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={color} strokeWidth="7"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color, lineHeight: 1 }}>
          <span style={{ fontSize: 22 }}>{score}</span><span style={{ fontSize: 12, color: 'var(--ink-4)' }}>/100</span>
        </span>
      </div>
    </div>
  )
}

export default function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(true)   // загрузка документа (не проверка)
  const [reviewing, setReviewing] = useState(false) // идёт платная проверка
  const [error, setError] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [docContent, setDocContent] = useState<string>('')
  const [reviewPrice, setReviewPrice] = useState(25) // цена проверки в токенах (с сервера)
  const [balance, setBalance] = useState<number | null>(null)
  // Мобильная вкладка: на <md показываем либо документ, либо панель замечаний
  // (тот же паттерн, что и «Документ / Догодок-чат» на рабочем экране)
  const [mobileTab, setMobileTab] = useState<'doc' | 'issues'>('doc')

  // Загрузка документа и цены — БЕЗ запуска проверки (проверка платная, стоит
  // токенов, поэтому запускается только явной кнопкой, а не при каждом открытии).
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const vid = searchParams.get('version')
    setVersionId(vid)

    fetch('/api/wallet')
      .then((r) => (r.ok ? r.json() : null))
      .then((w: { balance?: number; prices?: { review?: number } } | null) => {
        if (w && typeof w.balance === 'number') setBalance(w.balance)
        if (w?.prices?.review) setReviewPrice(w.prices.review)
      })
      .catch(() => {})

    fetch(`/api/documents/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Документ не найден')))
      .then((doc) => {
        const ver = vid ? doc.versions.find((v: { id: string }) => v.id === vid) : doc.versions[0]
        if (!ver) throw new Error('Нет версий для проверки')
        setVersionId(ver.id)
        // Контент берём из /api/versions/:id — там презентационные трансформы
        // (структурирование + эталонные шапка/реквизиты из ЛК), как на рабочем
        // экране. Сырой doc.versions[].content показывал устаревшие реквизиты.
        return fetch(`/api/versions/${ver.id}`)
      })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Не удалось загрузить версию')))
      .then((ver: { content: string | null }) => {
        if (!ver.content) throw new Error('Документ пустой — сначала сгенерируйте его через Догодок-чат')
        // Контент хранится как HTML — для построчного просмотра с подсветкой
        // рисков конвертируем в plain text, иначе теги <p>/<h2> видны буквально.
        setDocContent(isHtmlString(ver.content) ? htmlToPlainText(ver.content) : ver.content)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  // Запуск платной проверки — по явной кнопке. Списывает reviewPrice токенов.
  async function runReview() {
    if (!versionId || reviewing) return
    setReviewing(true)
    setError(null)
    try {
      const res = await fetch(`/api/versions/${versionId}/review`)
      const data = await res.json().catch(() => ({}))
      if (res.status === 402) {
        setError(data.error ?? 'Не хватает токенов для проверки.')
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'Ошибка проверки')
        return
      }
      setResult(data)
      // Обновляем баланс в шапке и на экране
      fetch('/api/wallet').then((r) => r.ok ? r.json() : null).then((w) => {
        if (w && typeof w.balance === 'number') setBalance(w.balance)
      }).catch(() => {})
    } catch {
      setError('Ошибка соединения. Попробуйте ещё раз.')
    } finally {
      setReviewing(false)
    }
  }

  if (loading || reviewing) {
    return (
      <div className="flex flex-col items-center justify-center gap-[16px]" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="w-[32px] h-[32px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
        <p className="text-[13px] text-[var(--ink-4)]">{reviewing ? 'Анализирую документ…' : 'Загружаю документ…'}</p>
      </div>
    )
  }

  // Заставка перед платной проверкой: показываем цену и ждём явного запуска.
  // Проверка стоит токенов — не запускаем автоматически при открытии экрана.
  if (!result && !error) {
    const enough = balance === null || balance >= reviewPrice
    return (
      <div className="flex flex-col items-center justify-center gap-[20px] px-6" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div className="text-center max-w-[380px]">
          <p className="text-[16px] font-medium text-[var(--ink)] mb-[6px]" style={{ fontFamily: 'var(--font-serif)' }}>
            Проверка договора на риски
          </p>
          <p className="text-[13px] text-[var(--ink-4)] leading-relaxed">
            Догодок проанализирует условия, найдёт риски и слабые места, оценит документ и предложит правки.
          </p>
        </div>
        <div className="flex flex-col items-center gap-[10px] w-full max-w-[280px]">
          <button
            onClick={runReview}
            disabled={!enough}
            className="w-full h-[42px] rounded-[var(--radius-md)] text-[14px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Проверить · {formatTokens(reviewPrice)}
          </button>
          {balance !== null && (
            <p className="text-[11px]" style={{ color: enough ? 'var(--ink-4)' : 'var(--danger)' }}>
              {enough
                ? `На балансе ${formatTokens(balance)}`
                : `Не хватает токенов: нужно ${reviewPrice}, на балансе ${balance}`}
            </p>
          )}
          <button
            onClick={() => router.push(`/documents/${id}`)}
            className="text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            ← Вернуться к документу
          </button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-[16px]" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="w-[48px] h-[48px] rounded-full bg-[oklch(0.97_0.015_20)] flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p className="text-[15px] font-medium text-[var(--ink)]">Не удалось проверить документ</p>
        <p className="text-[13px] text-[var(--ink-4)] text-center max-w-[360px]">{error}</p>
        <button
          onClick={() => router.push(`/documents/${id}`)}
          className="mt-[8px] h-[38px] px-[20px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
        >
          ← Вернуться к документу
        </button>
      </div>
    )
  }

  if (!result) return null

  return (
    <div className="flex flex-col md:flex-row" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

      {/* Мобильный переключатель Документ ↔ Замечания */}
      <div className="md:hidden shrink-0 flex" style={{ borderBottom: '1px solid var(--line)' }}>
        {([
          { key: 'doc', label: 'Документ' },
          { key: 'issues', label: `Замечания (${result.issues.length})` },
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

      {/* ── Левая колонка — документ ─────────────────────────────────────── */}
      <div className={[
        'flex-1 flex-col min-w-0 md:border-r md:border-[var(--line)]',
        mobileTab === 'issues' ? 'hidden md:flex' : 'flex',
      ].join(' ')}>

        {/* Toolbar */}
        <div
          className="shrink-0 flex items-center gap-[12px] px-[16px] md:px-[24px]"
          style={{ height: 48, borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}
        >
          <button
            onClick={() => router.push(`/documents/${id}/work${versionId ? `?version=${versionId}` : ''}`)}
            className="flex items-center gap-[6px] text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Назад к документу
          </button>
          <span className="text-[var(--line)]">·</span>
          <span className="text-[13px] font-medium text-[var(--ink)]">Проверка рисков</span>
        </div>

        {/* Документ с highlights */}
        <div
          className="flex-1 overflow-y-auto p-[16px] md:p-[32px_40px]"
          style={{ background: 'var(--bg-soft)' }}
        >
          <div
            className="mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm p-[24px_20px] md:p-[48px_56px] min-h-[400px] md:min-h-[600px]"
            style={{ maxWidth: 720 }}
          >
            {/* Отображаем параграфы с highlights для рисков */}
            {docContent.split('\n').map((line, i) => {
              const issue = result.issues.find((iss) =>
                line.toLowerCase().includes(iss.clause.replace('п. ', '').toLowerCase())
              )

              const isSelected = issue && selectedIssue === issue.id

              return (
                <p
                  key={i}
                  onClick={() => issue && setSelectedIssue(issue.id === selectedIssue ? null : issue.id)}
                  className={line === '' ? 'mb-[8px]' : [
                    'text-[14px] leading-[1.75] mb-[2px]',
                    issue ? 'cursor-pointer rounded-[3px] px-[2px] -mx-[2px]' : '',
                    issue?.severity === 'risk' && isSelected ? 'bg-[oklch(0.93_0.04_20)]' :
                    issue?.severity === 'risk' ? 'bg-[oklch(0.96_0.025_20)] hover:bg-[oklch(0.93_0.04_20)]' :
                    issue?.severity === 'warning' && isSelected ? 'bg-[oklch(0.93_0.04_60)]' :
                    issue?.severity === 'warning' ? 'bg-[oklch(0.96_0.025_60)] hover:bg-[oklch(0.93_0.04_60)]' : '',
                  ].join(' ')}
                  style={{ fontFamily: line.match(/^\d+\./) ? 'var(--font-serif)' : 'var(--font-serif)' }}
                >
                  {line || ' '}
                </p>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Правая колонка — результаты проверки ─────────────────────────── */}
      {/* На мобильных занимает весь экран (вкладка «Замечания»), на ≥md — 380px справа */}
      <div
        className={[
          'flex-col overflow-y-auto flex-1 md:flex-none md:shrink-0 w-full md:w-[380px] p-[16px] md:p-[20px]',
          mobileTab === 'doc' ? 'hidden md:flex' : 'flex',
        ].join(' ')}
        style={{ background: 'var(--bg)' }}
      >
        {/* Оценка */}
        <div className="flex items-center gap-[20px] mb-[20px]">
          <ScoreRing score={result.score} />
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)] mb-[6px]">Оценка документа</p>
            <div className="flex gap-[8px]">
              {result.riskCount > 0 && (
                <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.96 0.025 20)', color: 'var(--danger)' }}>
                  {result.riskCount} риск{result.riskCount > 1 ? 'а' : ''}
                </span>
              )}
              {result.warningCount > 0 && (
                <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.96 0.025 60)', color: 'oklch(0.55 0.1 60)' }}>
                  {result.warningCount} замеч.
                </span>
              )}
              {result.okCount > 0 && (
                <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.96 0.015 145)', color: 'oklch(0.45 0.1 145)' }}>
                  {result.okCount} OK
                </span>
              )}
              {(result.spellCount ?? 0) > 0 && (
                <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'var(--surface-inset)', color: 'var(--ink-3)', border: '1px solid var(--line-2)' }}>
                  {result.spellCount} орф. ошибк{result.spellCount === 1 ? 'а' : (result.spellCount ?? 0) < 5 ? 'и' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Саммари */}
        <p className="text-[12px] text-[var(--ink-3)] leading-[1.6] mb-[20px] pb-[20px]" style={{ borderBottom: '1px solid var(--line)' }}>
          {result.summary}
        </p>

        {/* Список замечаний */}
        <div className="flex flex-col gap-[8px]">
          {result.issues.map((issue) => {
            const cfg = SEVERITY_CONFIG[issue.severity] ?? SEVERITY_CONFIG.neutral
            const imp = issue.importance ? IMPORTANCE_CONFIG[issue.importance] : null
            const catLabel = issue.category ? CATEGORY_LABELS[issue.category] : null
            const isSelected = selectedIssue === issue.id
            return (
              <button
                key={issue.id}
                onClick={() => setSelectedIssue(isSelected ? null : issue.id)}
                className="w-full text-left rounded-[var(--radius-md)] transition-all cursor-pointer"
                style={{
                  padding: '10px 12px',
                  background: isSelected ? cfg.bg : 'var(--surface-inset)',
                  border: `1px solid ${isSelected ? cfg.color + '40' : 'transparent'}`,
                }}
              >
                <div className="flex items-start gap-[8px]">
                  <span
                    className="shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold mt-[1px]"
                    style={{ background: cfg.color, color: 'white' }}
                  >
                    {cfg.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Теги: категория + значимость + пункт */}
                    <div className="flex items-center gap-[4px] mb-[2px] flex-wrap">
                      {catLabel && (
                        <span className="text-[9px] px-[5px] py-[1px] rounded-full" style={{ background: 'var(--line)', color: 'var(--ink-4)' }}>{catLabel}</span>
                      )}
                      {imp && issue.importance !== 'low' && (
                        <span className="text-[9px] font-medium px-[5px] py-[1px] rounded-full" style={{ background: imp.bg, color: imp.color }}>{imp.label}</span>
                      )}
                      {issue.clause && issue.clause !== 'нет' && (
                        <span className="text-[10px] text-[var(--ink-4)] ml-auto shrink-0" style={{ fontFamily: 'var(--font-mono)' }}>{issue.clause}</span>
                      )}
                    </div>
                    <p className="text-[12px] font-medium text-[var(--ink)]">{issue.title}</p>
                    {isSelected && (
                      <>
                        <p className="text-[11px] text-[var(--ink-3)] leading-[1.5] mt-[4px]">{issue.description}</p>
                        {issue.recommendation && (
                          <span className="inline-block mt-[6px] text-[10px] font-semibold px-[6px] py-[1px] rounded-full"
                            style={{
                              background: issue.recommendation === 'Оставить' || issue.recommendation === 'Усилить' ? 'oklch(0.93 0.03 145)' : issue.recommendation === 'Исправить' || issue.recommendation === 'Добавить' ? 'oklch(0.92 0.03 20)' : 'var(--line)',
                              color: issue.recommendation === 'Оставить' || issue.recommendation === 'Усилить' ? 'oklch(0.4 0.12 145)' : issue.recommendation === 'Исправить' || issue.recommendation === 'Добавить' ? 'oklch(0.5 0.16 20)' : 'var(--ink-4)',
                            }}
                          >→ {issue.recommendation}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Кнопка — открыть чат */}
        <div className="mt-[20px] pt-[16px]" style={{ borderTop: '1px solid var(--line)' }}>
          <button
            onClick={() => {
              // Собираем задание для ИИ из найденных рисков и замечаний
              // (пункты «OK» не включаем — их править не нужно).
              const toFix = result.issues.filter((i) => i.severity === 'risk' || i.severity === 'warning')
              if (toFix.length > 0) {
                const lines = toFix.map((i) => {
                  const clause = i.clause ? `${i.clause} — ` : ''
                  const rec = i.recommendation ? ` Рекомендация: ${i.recommendation}` : ''
                  return `• ${clause}${i.title}.${rec}`
                })
                const prefill =
                  `Исправь в договоре следующие риски и замечания, выявленные при проверке:\n${lines.join('\n')}\n\n` +
                  `Внеси правки аккуратно, сохрани нумерацию пунктов и логическую связность (пересчитай суммы и сроки, если они меняются).`
                try { sessionStorage.setItem('chatPrefill', prefill) } catch { /* недоступно */ }
              }
              router.push(`/documents/${id}/work${versionId ? `?version=${versionId}` : ''}`)
            }}
            className="w-full h-[38px] rounded-[var(--radius-md)] bg-[var(--ink)] text-[var(--bg)] text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            ✦ Исправить через Догодок-чат
          </button>
        </div>
      </div>
    </div>
  )
}
