'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'

interface Version {
  id: string
  number: number
  status: string
  createdAt: string
  aiSettings: { description?: string }
}

// ─── Простое diff-сравнение по строкам ────────────────────────────────────────

type DiffLine = { type: 'same' | 'added' | 'removed'; text: string }

function diffTexts(a: string, b: string): DiffLine[] {
  const linesA = a.split('\n')
  const linesB = b.split('\n')
  const result: DiffLine[] = []

  const maxLen = Math.max(linesA.length, linesB.length)
  for (let i = 0; i < maxLen; i++) {
    const la = linesA[i]
    const lb = linesB[i]
    if (la === lb) {
      result.push({ type: 'same', text: la ?? '' })
    } else {
      if (la !== undefined) result.push({ type: 'removed', text: la })
      if (lb !== undefined) result.push({ type: 'added', text: lb })
    }
  }
  return result
}

// Mock-тексты двух версий
const VERSION_1 = `ДОГОВОР № ___
на разработку программного обеспечения

г. Москва                                           «__» ________ 2025 г.

ООО «Контрагент», именуемый в дальнейшем «Заказчик», с одной стороны, и Исполнитель, с другой стороны, заключили настоящий договор.

1. ПРЕДМЕТ ДОГОВОРА

1.1. Исполнитель обязуется разработать для Заказчика программный продукт.

2. СТОИМОСТЬ И ПОРЯДОК РАСЧЁТОВ

2.1. Стоимость работ определяется на основании Технического задания.

2.2. Оплата производится поэтапно: 30% — предоплата, 70% — после сдачи.

3. ОТВЕТСТВЕННОСТЬ СТОРОН

3.1. За просрочку оплаты Заказчик уплачивает пеню в размере 0,05% за каждый день.`

const VERSION_2 = `ДОГОВОР № ___
на разработку программного обеспечения

г. Москва                                           «__» ________ 2025 г.

ООО «Контрагент», именуемый в дальнейшем «Заказчик», с одной стороны, и Исполнитель, с другой стороны, заключили настоящий договор о нижеследующем:

1. ПРЕДМЕТ ДОГОВОРА

1.1. Исполнитель обязуется разработать для Заказчика программный продукт в соответствии с Техническим заданием.

2. СТОИМОСТЬ И ПОРЯДОК РАСЧЁТОВ

2.1. Стоимость работ определяется на основании Технического задания.

2.2. Оплата производится поэтапно: 30% — предоплата, 40% — после завершения вёрстки, 30% — после сдачи и приёмки.

3. ОТВЕТСТВЕННОСТЬ СТОРОН

3.1. За просрочку оплаты Заказчик уплачивает пеню в размере 0,1% за каждый день просрочки.`

function relDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

export default function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [versions, setVersions] = useState<Version[]>([])
  const [leftId, setLeftId] = useState<string>('')
  const [rightId, setRightId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((doc) => {
        const vers: Version[] = doc.versions
        setVersions(vers)
        if (vers.length >= 2) {
          setRightId(vers[0].id)
          setLeftId(vers[1].id)
        } else if (vers.length === 1) {
          setLeftId(vers[0].id)
          setRightId(vers[0].id)
        }
      })
      .catch(() => router.push(`/documents/${id}`))
      .finally(() => setLoading(false))
  }, [id])

  const diff = diffTexts(VERSION_1, VERSION_2)
  const addedCount = diff.filter((l) => l.type === 'added').length
  const removedCount = diff.filter((l) => l.type === 'removed').length

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
        className="shrink-0 flex items-center gap-[12px] px-[24px]"
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

        {/* Счётчики изменений */}
        <div className="flex items-center gap-[8px]">
          {addedCount > 0 && (
            <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.95 0.02 145)', color: 'oklch(0.45 0.1 145)' }}>
              +{addedCount}
            </span>
          )}
          {removedCount > 0 && (
            <span className="text-[11px] font-medium px-[8px] py-[2px] rounded-full" style={{ background: 'oklch(0.96 0.025 20)', color: 'var(--danger)' }}>
              −{removedCount}
            </span>
          )}
        </div>
      </div>

      {/* Основная область */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-soft)', padding: '24px 40px' }}>
        {/* Заголовки версий */}
        <div className="flex gap-[20px] max-w-[1100px] mx-auto mb-[12px]">
          <div className="flex-1">
            <p className="text-[12px] font-medium text-[var(--ink-3)]">
              v.{leftVer?.number} — {leftVer ? relDate(leftVer.createdAt) : ''}
            </p>
            {leftVer?.aiSettings?.description && (
              <p className="text-[11px] text-[var(--ink-4)]">{leftVer.aiSettings.description}</p>
            )}
          </div>
          <div className="flex-1">
            <p className="text-[12px] font-medium text-[var(--ink-3)]">
              v.{rightVer?.number} — {rightVer ? relDate(rightVer.createdAt) : ''}
            </p>
            {rightVer?.aiSettings?.description && (
              <p className="text-[11px] text-[var(--ink-4)]">{rightVer.aiSettings.description}</p>
            )}
          </div>
        </div>

        {/* Diff-вид: side by side */}
        {versions.length < 2 ? (
          <div
            className="max-w-[1100px] mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm"
            style={{ padding: '40px 48px' }}
          >
            <div className="text-center">
              <p className="text-[14px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
                Для сравнения нужны минимум две версии документа
              </p>
              <p className="text-[12px] text-[var(--ink-4)] mt-[8px]">
                Создайте новую версию через ИИ-чат
              </p>
              <button
                onClick={() => router.push(`/documents/${id}/work`)}
                className="mt-[16px] h-[36px] px-[16px] rounded-[var(--radius-md)] bg-[var(--ink)] text-[var(--bg)] text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                ✦ Открыть ИИ-чат
              </button>
            </div>
          </div>
        ) : (
          <div
            className="max-w-[1100px] mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm overflow-hidden"
          >
            {/* Unified diff */}
            <div style={{ padding: '32px 40px' }}>
              {diff.map((line, i) => (
                <div
                  key={i}
                  className={[
                    'flex items-start gap-[12px] px-[8px] py-[1px] rounded-[3px] -mx-[8px]',
                    line.type === 'added' ? 'bg-[oklch(0.95_0.025_145)]' :
                    line.type === 'removed' ? 'bg-[oklch(0.96_0.025_20)]' : '',
                  ].join(' ')}
                >
                  <span
                    className="shrink-0 w-[12px] text-[12px] font-medium"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: line.type === 'added' ? 'oklch(0.45 0.1 145)' :
                             line.type === 'removed' ? 'var(--danger)' : 'transparent',
                    }}
                  >
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                  </span>
                  <p
                    className="flex-1 text-[13px] leading-[1.75]"
                    style={{
                      fontFamily: 'var(--font-serif)',
                      color: line.type === 'added' ? 'oklch(0.35 0.1 145)' :
                             line.type === 'removed' ? 'oklch(0.45 0.1 20)' : 'var(--ink)',
                      textDecoration: line.type === 'removed' ? 'line-through' : 'none',
                      opacity: line.type === 'removed' ? 0.7 : 1,
                    }}
                  >
                    {line.text || ' '}
                  </p>
                </div>
              ))}
            </div>

            {/* Итоговая таблица изменений */}
            <div style={{ padding: '16px 40px 24px', borderTop: '1px solid var(--line)' }}>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[12px]">Изменения</p>
              <div className="grid grid-cols-3 gap-[12px]">
                {[
                  { label: 'Добавлено строк', value: addedCount, color: 'oklch(0.45 0.1 145)' },
                  { label: 'Удалено строк', value: removedCount, color: 'var(--danger)' },
                  { label: 'Без изменений', value: diff.filter((l) => l.type === 'same').length, color: 'var(--ink-4)' },
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
