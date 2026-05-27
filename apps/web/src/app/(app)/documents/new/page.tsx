'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Field, Textarea } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'

// ─── Типы ─────────────────────────────────────────────────────────────────────

type DocType = 'CONTRACT' | 'APPENDIX' | 'AMENDMENT'
type DocBase = 'scratch' | 'template' | 'upload'

interface Counterparty { id: string; name: string; inn: string | null }

interface Step1Data {
  type: DocType
  counterpartyId: string
  title: string
  number: string
  base: DocBase
  description: string
}

interface Step2Data {
  protectionLevel: number
  targetSize: number
  customInstruction: string
}

const DOC_TYPES = [
  { key: 'CONTRACT' as DocType, label: 'Договор', sub: 'Основной документ', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  )},
  { key: 'APPENDIX' as DocType, label: 'Приложение', sub: 'К существующему договору', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
  )},
  { key: 'AMENDMENT' as DocType, label: 'Доп. соглашение', sub: 'Изменения к договору', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  )},
]

const BASE_OPTIONS = [
  { key: 'scratch' as DocBase, label: 'С нуля по описанию', sub: 'ИИ составит с чистого листа' },
  { key: 'template' as DocBase, label: 'Из шаблона', sub: '12 готовых шаблонов' },
  { key: 'upload' as DocBase, label: 'Загрузить файл', sub: 'PDF, DOCX, RTF' },
]

const QUICK_CHIPS = ['NDA', 'Этапы оплаты', 'Подсудность', 'Передача прав', 'Форс-мажор']

// ─── Шаг 1 ───────────────────────────────────────────────────────────────────

function Step1({ data, onChange, counterparties }: {
  data: Step1Data
  onChange: (d: Step1Data) => void
  counterparties: Counterparty[]
}) {
  const set = <K extends keyof Step1Data>(k: K, v: Step1Data[K]) => onChange({ ...data, [k]: v })
  const charCount = data.description.length

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Тип документа */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Тип документа</p>
        <div className="grid grid-cols-3 gap-[10px]">
          {DOC_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => set('type', t.key)}
              className={['flex flex-col gap-[8px] p-[14px] rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer', data.type === t.key ? 'border-[var(--ink)] bg-[var(--surface-inset)]' : 'border-[var(--line-2)] hover:border-[var(--line-strong)]'].join(' ')}
            >
              <span className={data.type === t.key ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'}>{t.icon}</span>
              <div>
                <p className="text-[13px] font-medium text-[var(--ink)]">{t.label}</p>
                <p className="text-[12px] text-[var(--ink-4)]">{t.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Контрагент и название */}
      <Card>
        <div className="flex flex-col gap-[12px]">
          <Field label="Контрагент">
            <select
              className="w-full h-[38px] px-[12px] text-[14px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none appearance-none cursor-pointer focus:border-[var(--accent)] transition-colors"
              value={data.counterpartyId}
              onChange={(e) => set('counterpartyId', e.target.value)}
            >
              <option value="">Выберите контрагента</option>
              {counterparties.map((cp) => (
                <option key={cp.id} value={cp.id}>{cp.name}</option>
              ))}
            </select>
            {data.counterpartyId && <p className="mt-[4px] text-[12px] text-[var(--ink-4)]">Реквизиты подставятся автоматически. <span className="text-[var(--accent-ink)] cursor-pointer">Добавить нового</span></p>}
          </Field>

          <div className="grid grid-cols-[1fr_160px] gap-[10px]">
            <Field label="Название документа">
              <Input
                value={data.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Договор на разработку сайта"
              />
            </Field>
            <Field label="Номер">
              <Input value={data.number} onChange={(e) => set('number', e.target.value)} placeholder="17/03" />
            </Field>
          </div>
        </div>
      </Card>

      {/* База */}
      <Card>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">База для документа</p>
        <div className="grid grid-cols-3 gap-[10px] mb-[14px]">
          {BASE_OPTIONS.map((b) => (
            <button
              key={b.key}
              onClick={() => set('base', b.key)}
              className={['flex flex-col gap-[4px] p-[12px] rounded-[var(--radius-md)] border text-left transition-colors cursor-pointer', data.base === b.key ? 'border-[var(--ink)] bg-[var(--surface-inset)]' : 'border-[var(--line-2)] hover:border-[var(--line-strong)]'].join(' ')}
            >
              <p className="text-[13px] font-medium text-[var(--ink)]">{b.label}</p>
              <p className="text-[11px] text-[var(--ink-4)]">{b.sub}</p>
            </button>
          ))}
        </div>

        {data.base === 'scratch' && (
          <Field label="Краткое описание для ИИ">
            <Textarea
              value={data.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Опишите суть договора: предмет, сроки, ключевые условия оплаты, особые требования..."
              style={{ minHeight: 100 }}
              charCount={charCount}
              maxChars={4000}
            />
          </Field>
        )}
      </Card>
    </div>
  )
}

// ─── Шаг 2: Настройки ИИ ─────────────────────────────────────────────────────

function Step2({ data, onChange }: { data: Step2Data; onChange: (d: Step2Data) => void }) {
  const set = <K extends keyof Step2Data>(k: K, v: Step2Data[K]) => onChange({ ...data, [k]: v })

  const addChip = (chip: string) => {
    const instr = data.customInstruction
    const addition = instr ? `\n+ ${chip}` : `+ ${chip}`
    set('customInstruction', instr + addition)
  }

  const protectionLabel = data.protectionLevel <= 30 ? 'Дружелюбный' : data.protectionLevel <= 60 ? 'Сбалансированный' : 'Жёсткий'

  // Приближённый расчёт страниц
  const pages = Math.round(data.targetSize / 2100)
  const sizeLabel = data.targetSize < 3000 ? 'Краткий' : data.targetSize < 12000 ? 'Стандартный' : 'Развёрнутый'

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Уровень защищённости */}
      <Card>
        <div className="flex items-start justify-between mb-[6px]">
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)]">Уровень юридической защищённости</p>
            <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Чем выше — тем больше пунктов о неустойках, гарантиях, ответственности, защите ИС. Документ становится длиннее и жёстче.</p>
          </div>
          <span className="text-[13px] font-medium text-[var(--ink)] shrink-0 ml-[12px]" style={{ fontFamily:'var(--font-mono)' }}>{data.protectionLevel}%</span>
        </div>
        <Slider
          label=""
          value={data.protectionLevel}
          min={20} max={90} step={5}
          hint="Сбалансированный уровень — рекомендуем для коммерческих договоров"
          onChange={(v) => set('protectionLevel', v)}
          formatValue={(v) => `${v}%`}
        />
        <div className="flex justify-between mt-[4px]">
          {['Дружелюбный 20%','Сбалансированный 50%','Жёсткий 90%'].map((l) => (
            <p key={l} className="text-[11px] text-[var(--ink-4)]">{l}</p>
          ))}
        </div>
      </Card>

      {/* Целевой объём */}
      <Card>
        <div className="flex items-start justify-between mb-[6px]">
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)]">Целевой объём</p>
            <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Цифра означает знаков с пробелами. Финальный объём может слегка отличаться — ИИ оптимизирует под смысл.</p>
          </div>
          <span className="text-[13px] font-medium text-[var(--ink)] shrink-0 ml-[12px]" style={{ fontFamily:'var(--font-mono)' }}>
            ~ {data.targetSize.toLocaleString('ru')} зн.
          </span>
        </div>
        <Slider
          label=""
          value={data.targetSize}
          min={1500} max={25000} step={500}
          hint={`≈ ${pages} ${pages === 1 ? 'страница' : pages < 5 ? 'страницы' : 'страниц'} А4 шрифтом 11pt`}
          onChange={(v) => set('targetSize', v)}
          formatValue={(v) => `${v.toLocaleString('ru')} зн.`}
        />
        <div className="flex justify-between mt-[4px]">
          {['< 4 страниц А4','Стандартный','Развёрнутый'].map((l) => (
            <p key={l} className="text-[11px] text-[var(--ink-4)]">{l}</p>
          ))}
        </div>
      </Card>

      {/* Инструкция */}
      <Card>
        <div className="flex items-start justify-between mb-[6px]">
          <div>
            <p className="text-[13px] font-medium text-[var(--ink)]">Дополнительная инструкция</p>
            <p className="text-[12px] text-[var(--ink-3)] mt-[2px]">Опишите особенности этого договора своими словами. ИИ учтёт это при составлении.</p>
          </div>
          <span className="text-[12px] text-[var(--ink-4)] shrink-0 ml-[12px]" style={{ fontFamily:'var(--font-mono)' }}>
            {data.customInstruction.length} / 2000
          </span>
        </div>
        <Textarea
          value={data.customInstruction}
          onChange={(e) => set('customInstruction', e.target.value)}
          placeholder="Оплата поэтапная: 30% после утверждения дизайна, 40% после вёрстки, 30% после сдачи..."
          style={{ minHeight: 100 }}
        />
        <div className="flex flex-wrap gap-[6px] mt-[10px]">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => addChip(chip)}
              className="h-[28px] px-[10px] text-[12px] font-medium text-[var(--ink-2)] bg-[var(--surface-inset)] border border-[var(--line-2)] rounded-full hover:border-[var(--line-strong)] transition-colors cursor-pointer"
            >
              + {chip}
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────

export default function NewDocumentPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [step1, setStep1] = useState<Step1Data>({
    type: 'CONTRACT', counterpartyId: '', title: '', number: '', base: 'scratch', description: '',
  })
  const [step2, setStep2] = useState<Step2Data>({
    protectionLevel: 65, targetSize: 8400, customInstruction: '',
  })

  useEffect(() => {
    fetch('/api/counterparties')
      .then((r) => r.json())
      .then(setCounterparties)
      .catch(console.error)
  }, [])

  // Стоимость версии (заглушка — позже будет реальная формула)
  const versionPrice = Math.round(
    (step2.protectionLevel / 100) * 300 + (step2.targetSize / 1000) * 30 + 200
  )

  const handleSaveDraft = async () => {
    if (!step1.title.trim()) { setError('Укажите название документа'); return }
    if (!step1.counterpartyId) { setError('Выберите контрагента'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: step1.type, title: step1.title, number: step1.number,
          counterpartyId: step1.counterpartyId,
          aiSettings: { ...step2, base: step1.base, description: step1.description },
        }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error ?? 'Ошибка'); return }
      const doc = await res.json()
      router.push(`/documents/${doc.id}`)
    } finally { setSaving(false) }
  }

  const handleCreate = async () => {
    await handleSaveDraft()
    // В Фазе 7 здесь будет запуск генерации через BullMQ
  }

  const STEPS = ['Основные параметры', 'Настройки ИИ', 'Создание черновика']
  const TYPE_LABELS: Record<string, string> = { CONTRACT:'Договор', APPENDIX:'Приложение', AMENDMENT:'Доп. соглашение' }

  return (
    <div className="max-w-[1080px]">
      {/* Заголовок */}
      <div className="mb-[8px]">
        <p className="text-[12px] text-[var(--ink-4)] mb-[4px]">Шаг {step} из 3</p>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:400, marginBottom:6 }}>
          {step === 1 ? 'Создание документа' : 'Настройки ИИ'}
        </h2>
        <p className="text-[14px] text-[var(--ink-3)]">
          {step === 1
            ? 'Выберите тип, контрагента и базу. ИИ подготовит первый черновик с учётом ваших настроек — это будет версия v.1.'
            : 'Задайте, насколько жёстко документ должен защищать ваши интересы и насколько он должен быть объёмным. При желании — добавьте инструкцию своими словами.'}
        </p>
      </div>

      {/* Прогресс шагов */}
      <div className="flex items-center gap-[0] mb-[24px] mt-[16px]">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-[8px]">
              <div className={['w-[24px] h-[24px] rounded-full flex items-center justify-center text-[12px] font-medium shrink-0', i + 1 < step ? 'bg-[var(--ok)] text-white' : i + 1 === step ? 'bg-[var(--ink)] text-[var(--bg)]' : 'bg-[var(--surface-2)] text-[var(--ink-4)]'].join(' ')}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <p className={['text-[13px]', i + 1 === step ? 'font-medium text-[var(--ink)]' : 'text-[var(--ink-4)]'].join(' ')}>{label}</p>
            </div>
            {i < STEPS.length - 1 && <div className="w-[32px] h-[1px] bg-[var(--line-2)] mx-[8px]" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-[20px]">
        {/* Основная форма */}
        <div>
          {step === 1 && <Step1 data={step1} onChange={setStep1} counterparties={counterparties} />}
          {step === 2 && <Step2 data={step2} onChange={setStep2} />}
        </div>

        {/* Правая панель */}
        <div className="flex flex-col gap-[12px]">
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">
              {step === 1 ? 'Стоимость версии' : 'Предпросмотр настроек'}
            </p>
            {step === 1 ? (
              <>
                <p style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:400, marginBottom:4 }}>
                  {versionPrice} ₽
                </p>
                <p className="text-[12px] text-[var(--ink-4)] mb-[12px]">Списание при утверждении v.1</p>
                <div className="bg-[var(--surface-inset)] rounded-[var(--radius-md)] px-[12px] py-[10px]">
                  <p className="text-[12px] text-[var(--ink-3)]">
                    Баланс: <span className="font-medium text-[var(--ink)]">0 ₽</span> — будет недостаточно
                  </p>
                </div>
                <div className="mt-[12px] pt-[12px] border-t border-[var(--line)]">
                  <p className="text-[11px] text-[var(--ink-4)] mb-[6px]">Как считается стоимость?</p>
                  <p className="text-[12px] text-[var(--ink-3)] leading-[1.5]">Цена зависит от типа документа, объёма и уровня юридической защищённости. Деньги списываются только когда вы утверждаете версию.</p>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-[8px] text-[13px]">
                <div className="flex justify-between">
                  <p className="text-[var(--ink-3)]">Защищённость</p>
                  <p className="font-medium">{step2.protectionLevel}%</p>
                </div>
                <div className="flex justify-between">
                  <p className="text-[var(--ink-3)]">Объём</p>
                  <p className="font-medium">~ {step2.targetSize.toLocaleString('ru')} зн.</p>
                </div>
                <div className="flex justify-between">
                  <p className="text-[var(--ink-3)]">Тон</p>
                  <p className="font-medium">{step2.protectionLevel >= 70 ? 'Формальный' : 'Деловой'}</p>
                </div>
                {step2.customInstruction && (
                  <div className="mt-[4px] pt-[8px] border-t border-[var(--line)]">
                    <p className="text-[11px] text-[var(--ink-4)] mb-[4px]">Инструкция добавлена</p>
                    <p className="text-[12px] text-[var(--ink-3)] line-clamp-3">{step2.customInstruction}</p>
                  </div>
                )}
                <div className="mt-[4px] pt-[8px] border-t border-[var(--line)]">
                  <p className="text-[11px] text-[var(--ink-4)] mb-[4px]">Эти настройки можно менять</p>
                  <p className="text-[12px] text-[var(--ink-3)]">Изменения сохраняются для этой версии. В новой версии — можно задать новые.</p>
                </div>
              </div>
            )}
          </Card>

          {step === 1 && step1.title && (
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[8px]">Превью</p>
              <p className="text-[12px] text-[var(--ink-4)] mb-[2px]">{TYPE_LABELS[step1.type]}{step1.number ? ` № ${step1.number}` : ''}</p>
              <p className="text-[13px] font-medium text-[var(--ink)]">{step1.title}</p>
              {step1.counterpartyId && (
                <p className="text-[12px] text-[var(--ink-3)] mt-[4px]">
                  {counterparties.find((c) => c.id === step1.counterpartyId)?.name}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Нижняя панель */}
      <div className="flex items-center justify-between mt-[24px] pt-[16px] border-t border-[var(--line)]">
        <div>{error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}</div>
        <div className="flex items-center gap-[10px]">
          <Button variant="ghost" onClick={() => step > 1 ? setStep(step - 1) : router.push('/documents')}>
            {step > 1 ? '← Назад' : 'Отменить'}
          </Button>
          <Button variant="secondary" onClick={handleSaveDraft} loading={saving && step === 2}>
            Сохранить как черновик
          </Button>
          {step === 1 ? (
            <Button variant="primary" onClick={() => {
              if (!step1.title.trim()) { setError('Укажите название документа'); return }
              if (!step1.counterpartyId) { setError('Выберите контрагента'); return }
              setError(null); setStep(2)
            }}>
              Далее — настройки ИИ →
            </Button>
          ) : (
            <Button variant="primary" onClick={handleCreate} loading={saving}>
              ✦ Создать черновик · {versionPrice} ₽ позже
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
