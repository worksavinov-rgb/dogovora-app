'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'

interface Version {
  id: string
  number: number
  status: string
  createdAt: string
  content: string | null
  aiSettings: { description?: string }
}

// ─── Алгоритм LCS для пословного diff ────────────────────────────────────────

type WordToken = { text: string; type: 'same' | 'added' | 'removed' }

/**
 * Вычисляет пословный diff между двумя строками.
 * Возвращает массив токенов с пометками same/added/removed.
 */
function wordDiff(oldText: string, newText: string): WordToken[] {
  // Разбиваем с сохранением разделителей (пробелы, переносы, знаки препинания)
  const tokenize = (s: string) => s.split(/(\s+|(?<=[а-яА-Яa-zA-Z\d])(?=[^а-яА-Яa-zA-Z\d])|(?<=[^а-яА-Яa-zA-Z\d])(?=[а-яА-Яa-zA-Z\d]))/).filter(Boolean)

  const oldWords = tokenize(oldText)
  const newWords = tokenize(newText)

  // LCS через динамическое программирование
  const m = oldWords.length
  const n = newWords.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Восстанавливаем путь
  const result: WordToken[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      result.unshift({ text: oldWords[i - 1]!, type: 'same' })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ text: newWords[j - 1]!, type: 'added' })
      j--
    } else {
      result.unshift({ text: oldWords[i - 1]!, type: 'removed' })
      i--
    }
  }

  return result
}

/**
 * Разбивает текст по строкам и применяет пословный diff к каждой паре строк.
 * Возвращает строки с токенами.
 */
type DiffLine = {
  lineType: 'same' | 'changed' | 'added' | 'removed'
  tokens: WordToken[]
}

function diffDocuments(textA: string, textB: string): DiffLine[] {
  const linesA = textA.split('\n')
  const linesB = textB.split('\n')
  const result: DiffLine[] = []

  // LCS на уровне строк
  const m = linesA.length
  const n = linesB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Восстанавливаем путь
  let i = m, j = n
  const ops: Array<{ type: 'same' | 'changed' | 'added' | 'removed'; a?: string; b?: string }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      ops.unshift({ type: 'same', a: linesA[i - 1], b: linesB[j - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Смотрим можно ли смерджить с предыдущим removed → changed
      const last = ops[0]
      if (last?.type === 'removed' && last.a !== undefined) {
        ops[0] = { type: 'changed', a: last.a, b: linesB[j - 1] }
      } else {
        ops.unshift({ type: 'added', b: linesB[j - 1] })
      }
      j--
    } else {
      ops.unshift({ type: 'removed', a: linesA[i - 1] })
      i--
    }
  }

  for (const op of ops) {
    if (op.type === 'same') {
      result.push({ lineType: 'same', tokens: [{ text: op.a ?? '', type: 'same' }] })
    } else if (op.type === 'added') {
      result.push({ lineType: 'added', tokens: [{ text: op.b ?? '', type: 'added' }] })
    } else if (op.type === 'removed') {
      result.push({ lineType: 'removed', tokens: [{ text: op.a ?? '', type: 'removed' }] })
    } else if (op.type === 'changed') {
      // Пословный diff изменённой строки
      const tokens = wordDiff(op.a ?? '', op.b ?? '')
      result.push({ lineType: 'changed', tokens })
    }
  }

  return result
}

function relDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Рендер одного токена ─────────────────────────────────────────────────────

function Token({ token }: { token: WordToken }) {
  if (token.type === 'same') {
    return <span>{token.text}</span>
  }
  if (token.type === 'added') {
    return (
      <span
        style={{
          background: 'oklch(0.93 0.05 145)',
          color: 'oklch(0.35 0.12 145)',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {token.text}
      </span>
    )
  }
  // removed
  return (
    <span
      style={{
        background: 'oklch(0.93 0.05 20)',
        color: 'oklch(0.45 0.15 20)',
        textDecoration: 'line-through',
        textDecorationColor: 'oklch(0.55 0.15 20)',
        borderRadius: 2,
        padding: '0 1px',
        opacity: 0.8,
      }}
    >
      {token.text}
    </span>
  )
}

// ─── Рендер строки diff ───────────────────────────────────────────────────────

function DiffLineRow({ line, index }: { line: DiffLine; index: number }) {
  const bgColor =
    line.lineType === 'added' ? 'oklch(0.97 0.02 145)' :
    line.lineType === 'removed' ? 'oklch(0.97 0.02 20)' :
    line.lineType === 'changed' ? 'oklch(0.97 0.01 60)' : 'transparent'

  const marker =
    line.lineType === 'added' ? { char: '+', color: 'oklch(0.45 0.1 145)' } :
    line.lineType === 'removed' ? { char: '−', color: 'oklch(0.45 0.12 20)' } :
    line.lineType === 'changed' ? { char: '~', color: 'oklch(0.55 0.08 60)' } :
    null

  const isEmpty = line.tokens.every((t) => t.text.trim() === '')

  return (
    <div
      className="flex items-start gap-[12px] -mx-[8px] px-[8px] py-[1px] rounded-[3px]"
      style={{ background: bgColor, minHeight: 24 }}
    >
      {/* Маркер */}
      <span
        className="shrink-0 w-[10px] text-[11px] font-bold mt-[1px] select-none"
        style={{ fontFamily: 'var(--font-mono)', color: marker?.color ?? 'transparent' }}
      >
        {marker?.char ?? ' '}
      </span>

      {/* Текст */}
      <p
        className="flex-1 text-[13px] leading-[1.75] flex-wrap"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {isEmpty ? ' ' : line.tokens.map((tok, i) => <Token key={i} token={tok} />)}
      </p>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [versions, setVersions] = useState<Version[]>([])
  const [leftId, setLeftId] = useState<string>('')
  const [rightId, setRightId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [leftContent, setLeftContent] = useState<string>('')
  const [rightContent, setRightContent] = useState<string>('')

  // Загружаем список версий
  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((doc) => {
        const vers: Version[] = doc.versions
        setVersions(vers)
        if (vers.length >= 2) {
          setLeftId(vers[vers.length - 1].id)  // самая старая
          setRightId(vers[0].id)               // самая новая
        } else if (vers.length === 1) {
          setLeftId(vers[0].id)
          setRightId(vers[0].id)
        }
      })
      .catch(() => router.push(`/documents/${id}`))
      .finally(() => setLoading(false))
  }, [id])

  // Загружаем контент когда меняются выбранные версии
  useEffect(() => {
    if (!leftId || !rightId) return
    setLoadingContent(true)

    Promise.all([
      fetch(`/api/versions/${leftId}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/versions/${rightId}`).then((r) => r.ok ? r.json() : null),
    ]).then(([left, right]) => {
      setLeftContent(left?.content ?? '')
      setRightContent(right?.content ?? '')
    }).finally(() => setLoadingContent(false))
  }, [leftId, rightId])

  const diff = leftContent || rightContent ? diffDocuments(leftContent, rightContent) : []

  // Статистика изменений
  const addedLines = diff.filter((l) => l.lineType === 'added').length
  const removedLines = diff.filter((l) => l.lineType === 'removed').length
  const changedLines = diff.filter((l) => l.lineType === 'changed').length
  const sameLines = diff.filter((l) => l.lineType === 'same').length

  // Посчитаем токены
  const addedWords = diff.flatMap((l) => l.tokens).filter((t) => t.type === 'added').length
  const removedWords = diff.flatMap((l) => l.tokens).filter((t) => t.type === 'removed').length

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  const leftVer = versions.find((v) => v.id === leftId)
  const rightVer = versions.find((v) => v.id === rightId)

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center gap-[12px] px-[24px] flex-wrap"
        style={{ height: 52, borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}
      >
        <button
          onClick={() => router.push(`/documents/${id}`)}
          className="flex items-center gap-[6px] text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          К документу
        </button>

        <span className="text-[var(--line)]">·</span>
        <span className="text-[13px] font-medium text-[var(--ink)]">Сравнение версий</span>

        <div className="flex-1" />

        {/* Выбор версий */}
        <div className="flex items-center gap-[8px]">
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="h-[30px] px-[8px] text-[12px] rounded-[var(--radius-md)] bg-[var(--surface-inset)] text-[var(--ink)] border border-[var(--line)] outline-none cursor-pointer"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>v.{v.number} — {relDate(v.createdAt)}</option>
            ))}
          </select>

          <span className="text-[12px] text-[var(--ink-4)]">⇄</span>

          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="h-[30px] px-[8px] text-[12px] rounded-[var(--radius-md)] bg-[var(--surface-inset)] text-[var(--ink)] border border-[var(--line)] outline-none cursor-pointer"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>v.{v.number} — {relDate(v.createdAt)}</option>
            ))}
          </select>
        </div>

        {/* Счётчики */}
        <div className="flex items-center gap-[6px]">
          {addedWords > 0 && (
            <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.95 0.02 145)', color: 'oklch(0.40 0.1 145)' }}>
              +{addedWords} сл.
            </span>
          )}
          {removedWords > 0 && (
            <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.96 0.025 20)', color: 'oklch(0.45 0.15 20)' }}>
              −{removedWords} сл.
            </span>
          )}
        </div>
      </div>

      {/* Основная область */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-soft)', padding: '24px 40px' }}>

        {/* Заголовки версий */}
        <div className="max-w-[860px] mx-auto mb-[12px] flex gap-[12px]">
          <div className="flex-1">
            <p className="text-[12px] font-medium text-[var(--ink-3)]">
              v.{leftVer?.number} — {leftVer ? relDate(leftVer.createdAt) : ''}
            </p>
            {leftVer?.aiSettings?.description && (
              <p className="text-[11px] text-[var(--ink-4)]">{leftVer.aiSettings.description}</p>
            )}
          </div>
          <div className="text-[12px] text-[var(--ink-4)]">→</div>
          <div className="flex-1">
            <p className="text-[12px] font-medium text-[var(--ink-3)]">
              v.{rightVer?.number} — {rightVer ? relDate(rightVer.createdAt) : ''}
            </p>
            {rightVer?.aiSettings?.description && (
              <p className="text-[11px] text-[var(--ink-4)]">{rightVer.aiSettings.description}</p>
            )}
          </div>
        </div>

        {/* Нет версий */}
        {versions.length < 2 ? (
          <div className="max-w-[860px] mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm p-[48px] text-center">
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center mx-auto mb-[16px]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <p className="text-[15px] text-[var(--ink-2)] mb-[8px]" style={{ fontFamily: 'var(--font-serif)' }}>
              Для сравнения нужны минимум две версии
            </p>
            <p className="text-[12px] text-[var(--ink-4)] mb-[16px]">
              Откройте рабочий экран, попросите ИИ внести правки, затем сохраните как новую версию
            </p>
            <button
              onClick={() => router.push(`/documents/${id}/work`)}
              className="h-[36px] px-[16px] rounded-[var(--radius-md)] bg-[var(--ink)] text-[var(--bg)] text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              ✦ Открыть рабочий экран
            </button>
          </div>

        ) : loadingContent ? (
          <div className="max-w-[860px] mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm p-[48px] flex items-center justify-center gap-[12px]">
            <div className="w-[20px] h-[20px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
            <p className="text-[13px] text-[var(--ink-3)]">Загружаю версии…</p>
          </div>

        ) : (!leftContent && !rightContent) ? (
          <div className="max-w-[860px] mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm p-[48px] text-center">
            <p className="text-[14px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
              Контент версий пока не сгенерирован
            </p>
            <p className="text-[12px] text-[var(--ink-4)] mt-[8px]">
              Откройте рабочий экран и запустите генерацию
            </p>
          </div>

        ) : (
          <div className="max-w-[860px] mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm overflow-hidden">
            {/* Легенда */}
            <div className="flex items-center gap-[16px] px-[32px] py-[12px]" style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-inset)' }}>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em]">Обозначения:</p>
              <span className="flex items-center gap-[5px] text-[11px]">
                <span className="inline-block w-[10px] h-[10px] rounded-sm" style={{ background: 'oklch(0.93 0.05 145)' }} />
                <span style={{ color: 'oklch(0.35 0.12 145)' }}>добавлено</span>
              </span>
              <span className="flex items-center gap-[5px] text-[11px]">
                <span className="inline-block w-[10px] h-[10px] rounded-sm" style={{ background: 'oklch(0.93 0.05 20)' }} />
                <span style={{ color: 'oklch(0.45 0.15 20)' }}>удалено</span>
              </span>
              <span className="flex items-center gap-[5px] text-[11px]">
                <span style={{ color: 'var(--ink-4)' }}>~ строка изменена</span>
              </span>
            </div>

            {/* Diff */}
            <div style={{ padding: '28px 40px' }}>
              {diff.map((line, i) => (
                <DiffLineRow key={i} line={line} index={i} />
              ))}
            </div>

            {/* Итоговая таблица */}
            <div style={{ padding: '16px 40px 24px', borderTop: '1px solid var(--line)' }}>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[12px]">Итог сравнения</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
                {[
                  { label: 'Добавлено слов', value: addedWords, color: 'oklch(0.40 0.1 145)' },
                  { label: 'Удалено слов', value: removedWords, color: 'oklch(0.45 0.15 20)' },
                  { label: 'Изменено строк', value: changedLines, color: 'oklch(0.50 0.08 60)' },
                  { label: 'Без изменений', value: sameLines, color: 'var(--ink-4)' },
                ].map((row) => (
                  <div key={row.label} className="rounded-[var(--radius-md)] bg-[var(--surface-inset)] px-[12px] py-[10px]">
                    <p className="text-[20px] font-medium" style={{ fontFamily: 'var(--font-mono)', color: row.color }}>{row.value}</p>
                    <p className="text-[11px] text-[var(--ink-4)] mt-[2px]">{row.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
