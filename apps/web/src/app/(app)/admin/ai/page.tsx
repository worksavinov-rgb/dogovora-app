'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  GIGACHAT_TASK_MODEL_HINTS,
  POLZA_TASK_MODEL_HINTS,
  pickRecommendedModel,
} from '@/lib/ai/gigachat-models'
import { ModelCombobox, type ModelOption } from './model-combobox'

interface OperatorRow {
  id: string
  slug: string
  name: string
  isEnabled: boolean
  credentialsMasked: Record<string, string>
  hasCredentials: boolean
}

interface RouteRow {
  task: string
  usesDefault: boolean
  operatorId: string
  operatorSlug: string
  modelId: string
  temperature: number
  maxTokens: number | null
  isEnabled: boolean
}

interface TaskDef {
  task: string
  label: string
  description: string
  uiWhere?: string
  primary: boolean
}

interface UsageSummary {
  totalCostRub: number
  totalTokens: number
  requestCount: number
  byTask: Array<{ task: string; costRub: number; tokens: number; count: number }>
}

const TASK_ORDER = [
  'default',
  'generate',
  'edit',
  'chat',
  'quick_analysis',
  'review',
  'analyze_upload',
  'extract_parties',
  'spelling',
  'review_fallback',
] as const

const USE_DEFAULT = '__default__'

const OPERATOR_FIELDS: Record<string, Array<{ key: string; label: string; secret?: boolean; hint?: string }>> = {
  polza: [
    { key: 'apiKey', label: 'API Key', secret: true, hint: 'Ключ из личного кабинета polza.ai → API Keys' },
    { key: 'baseUrl', label: 'Base URL', hint: 'Обычно https://polza.ai/api/v1 — менять не нужно' },
  ],
  openrouter: [
    { key: 'apiKey', label: 'API Key', secret: true, hint: 'Ключ из openrouter.ai → Keys' },
    { key: 'baseUrl', label: 'Base URL', hint: 'Обычно https://openrouter.ai/api/v1 — менять не нужно' },
  ],
  gigachat: [
    { key: 'authKey', label: 'Auth Key', secret: true, hint: 'Authorization key из кабинета GigaChat (Basic auth)' },
    { key: 'scope', label: 'Scope', hint: 'Область доступа OAuth, обычно GIGACHAT_API_PERS' },
    { key: 'baseUrl', label: 'Base URL', hint: 'URL API GigaChat — менять не нужно' },
    { key: 'authUrl', label: 'Auth URL', hint: 'URL OAuth GigaChat — менять не нужно' },
  ],
}

function HintLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      title={hint}
      className="cursor-help border-b border-dotted border-[var(--ink-4)]/60"
    >
      {label}
    </span>
  )
}

const ROUTE_HEADER_HINTS = {
  task: 'Какая операция ИИ выполняется в приложении',
  operator: 'Провайдер: Polza.ai, OpenRouter, GigaChat',
  model: 'Модель для этой задачи. Пусто — берётся из строки «По умолчанию»',
  temperature:
    'Температура (0–2): 0.1–0.2 — точно (проверка, JSON). 0.3–0.5 — правки и генерация. 0.7+ — чат',
} as const

const TEMPERATURE_HINT =
  '0.1 — строго · 0.3–0.5 — договоры · 0.7+ — диалог'

function sortTaskDefs(defs: TaskDef[]): TaskDef[] {
  return [...defs].sort(
    (a, b) => TASK_ORDER.indexOf(a.task as typeof TASK_ORDER[number]) - TASK_ORDER.indexOf(b.task as typeof TASK_ORDER[number]),
  )
}

function mergeRoutes(taskDefs: TaskDef[], apiRoutes: Omit<RouteRow, 'usesDefault'>[]): RouteRow[] {
  return sortTaskDefs(taskDefs).map((def) => {
    const existing = apiRoutes.find((r) => r.task === def.task)
    if (existing) {
      return { ...existing, usesDefault: false }
    }
    return {
      task: def.task,
      usesDefault: def.task !== 'default',
      operatorId: '',
      operatorSlug: '',
      modelId: '',
      temperature: 0.7,
      maxTokens: null,
      isEnabled: true,
    }
  })
}

export default function AdminAIPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [operators, setOperators] = useState<OperatorRow[]>([])
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [taskDefs, setTaskDefs] = useState<TaskDef[]>([])
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [gigachatModels, setGigachatModels] = useState<ModelOption[]>([])
  const [polzaModels, setPolzaModels] = useState<ModelOption[]>([])
  const [openrouterModels, setOpenrouterModels] = useState<ModelOption[]>([])
  const [credForms, setCredForms] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  /** Развёрнутые карточки операторов (по умолчанию свёрнуты, если ключ уже задан) */
  const [expandedOps, setExpandedOps] = useState<Record<string, boolean>>({})
  const opsInitRef = useRef(false)

  const defaultRoute = useMemo(
    () => routes.find((r) => r.task === 'default' && !r.usesDefault && r.modelId),
    [routes],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfgRes, usageRes] = await Promise.all([
        fetch('/api/admin/ai/config'),
        fetch('/api/admin/ai/usage?period=month'),
      ])
      if (cfgRes.status === 403) {
        setError('Доступ только для администратора')
        return
      }
      if (!cfgRes.ok) throw new Error('Не удалось загрузить конфигурацию')
      const cfg = await cfgRes.json()
      setOperators(cfg.operators)
      setTaskDefs(cfg.taskDefinitions ?? [])
      setRoutes(mergeRoutes(cfg.taskDefinitions ?? [], cfg.routes ?? []))
      setGigachatModels(cfg.gigachatModels ?? [])
      if (!opsInitRef.current) {
        opsInitRef.current = true
        const initial: Record<string, boolean> = {}
        for (const op of cfg.operators ?? []) {
          // Без ключа — развернуть, чтобы сразу настроить; с ключом — свернуть
          initial[op.slug] = !op.hasCredentials
        }
        setExpandedOps(initial)
      }

      if (usageRes.ok) setUsage(await usageRes.json())

      const [polzaModelsRes, openrouterModelsRes] = await Promise.all([
        fetch('/api/admin/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list-models', slug: 'polza' }),
        }),
        fetch('/api/admin/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list-models', slug: 'openrouter' }),
        }),
      ])
      if (polzaModelsRes.ok) {
        const m = await polzaModelsRes.json()
        setPolzaModels(m.models ?? [])
      }
      if (openrouterModelsRes.ok) {
        const m = await openrouterModelsRes.json()
        setOpenrouterModels(m.models ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function importFromEnv() {
    setSaving('import')
    const res = await fetch('/api/admin/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import-env' }),
    })
    setSaving(null)
    if (!res.ok) { toast('Ошибка импорта из ENV', 'error'); return }
    toast('Конфигурация импортирована', 'success')
    await load()
  }

  async function saveOperator(slug: string) {
    const op = operators.find((o) => o.slug === slug)
    if (!op) return
    setSaving(`op-${slug}`)
    const res = await fetch('/api/admin/ai/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        name: op.name,
        isEnabled: op.isEnabled,
        credentials: credForms[slug] ?? {},
      }),
    })
    setSaving(null)
    if (!res.ok) { toast(`Ошибка сохранения ${slug}`, 'error'); return }
    setCredForms((f) => ({ ...f, [slug]: {} }))
    toast(`${op.name} сохранён`, 'success')
    await load()
  }

  async function testOperator(slug: string) {
    setSaving(`test-${slug}`)
    const res = await fetch('/api/admin/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test-operator', slug }),
    })
    setSaving(null)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) toast(data.error ?? 'Ошибка проверки', 'error')
    else toast(slug === 'polza' ? `Polza: баланс ${data.balance} ₽` : 'Соединение OK', 'success')
  }

  async function saveRoute(task: string) {
    const route = routes.find((r) => r.task === task)
    if (!route) return

    if (task === 'default' && (!route.operatorId || !route.modelId)) {
      toast('Заполните оператор и модель для «По умолчанию»', 'error')
      return
    }
    if (task !== 'default' && !route.usesDefault && (!route.operatorId || !route.modelId)) {
      toast('Выберите оператор и модель или «По умолчанию»', 'error')
      return
    }

    setSaving(`route-${task}`)
    const body = route.usesDefault && task !== 'default'
      ? { task, useDefault: true }
      : {
          task: route.task,
          operatorId: route.operatorId,
          modelId: route.modelId,
          temperature: route.temperature,
          maxTokens: route.maxTokens,
          isEnabled: route.isEnabled,
        }

    const res = await fetch('/api/admin/ai/routes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(null)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast(data.error ?? 'Ошибка сохранения маршрута', 'error')
      return
    }

    if (route.usesDefault && task !== 'default') {
      setRoutes((prev) => prev.map((r) => (
        r.task === task
          ? { ...r, usesDefault: true, operatorId: '', operatorSlug: '', modelId: '' }
          : r
      )))
    }

    const label = taskDefs.find((d) => d.task === task)?.label ?? task
    toast(`${label}: сохранено`, 'success')
  }

  function modelsForOperator(slug: string): ModelOption[] {
    if (slug === 'gigachat') return gigachatModels
    if (slug === 'polza') return polzaModels
    if (slug === 'openrouter') return openrouterModels
    return [{ id: 'mock', name: 'mock' }]
  }

  function recommendedFor(task: string, slug: string): string | null {
    if (slug === 'gigachat') return GIGACHAT_TASK_MODEL_HINTS[task] ?? null
    if (slug === 'polza' || slug === 'openrouter') return POLZA_TASK_MODEL_HINTS[task]?.[0] ?? null
    return null
  }

  function modelLabel(m: ModelOption, task: string, slug: string): string {
    const rec = recommendedFor(task, slug)
    const base = m.description ? `${m.name} — ${m.description}` : m.name
    return m.id === rec ? `${base} ★` : base
  }

  function defaultHint(): string {
    if (!defaultRoute) return 'Сначала настройте строку «По умолчанию»'
    const op = operators.find((o) => o.id === defaultRoute.operatorId)?.name ?? defaultRoute.operatorSlug
    return `${op} · ${defaultRoute.modelId}`
  }

  function updateRoute(task: string, patch: Partial<RouteRow>) {
    setRoutes((prev) => prev.map((r) => (r.task === task ? { ...r, ...patch } : r)))
  }

  function selectOperator(task: string, operatorId: string) {
    if (operatorId === USE_DEFAULT) {
      updateRoute(task, {
        usesDefault: true,
        operatorId: '',
        operatorSlug: '',
        modelId: '',
      })
      return
    }
    const op = operators.find((o) => o.id === operatorId)
    const slug = op?.slug ?? ''
    const models = modelsForOperator(slug)
    updateRoute(task, {
      usesDefault: false,
      operatorId,
      operatorSlug: slug,
      modelId: pickRecommendedModel(slug, task, models),
    })
  }

  function renderRouteRow(def: TaskDef) {
    const route = routes.find((r) => r.task === def.task) ?? {
      task: def.task,
      usesDefault: def.task !== 'default',
      operatorId: '',
      operatorSlug: '',
      modelId: '',
      temperature: 0.7,
      maxTokens: null,
      isEnabled: true,
    }
    const isDefaultRow = def.task === 'default'
    const inherited = !isDefaultRow && route.usesDefault
    const opSlug = operators.find((o) => o.id === route.operatorId)?.slug ?? route.operatorSlug
    const models = modelsForOperator(opSlug)
    const operatorValue = inherited ? USE_DEFAULT : (route.operatorId || '')
    const rec = !inherited && opSlug ? recommendedFor(def.task, opSlug) : null

    return (
      <tr key={def.task} className="border-b border-[var(--line)]">
        <td className="py-3 pr-4 align-top">
          <p className="font-medium text-[var(--ink)]">{def.label}</p>
          <p className="text-[11px] text-[var(--ink-4)] max-w-[240px]">{def.description}</p>
          {def.uiWhere && (
            <p className="text-[11px] text-[var(--ink-3)] mt-1 max-w-[240px]">UI: {def.uiWhere}</p>
          )}
          {inherited && (
            <p className="text-[11px] text-[var(--ink-3)] mt-1">→ {defaultHint()}</p>
          )}
          {!inherited && rec && (
            <p className="text-[11px] text-[var(--ink-3)] mt-1">рекомендуем: {rec}</p>
          )}
        </td>
        <td className="py-3 pr-4">
          <select
            className="h-[32px] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-white text-[13px] min-w-[140px]"
            value={operatorValue}
            onChange={(e) => selectOperator(def.task, e.target.value)}
          >
            {!isDefaultRow && <option value={USE_DEFAULT}>— по умолчанию —</option>}
            {isDefaultRow && <option value="">— выберите —</option>}
            {operators.filter((o) => o.slug !== 'mock').map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </td>
        <td className="py-3 pr-4">
          <ModelCombobox
            value={inherited ? '' : route.modelId}
            options={inherited ? [] : models}
            disabled={inherited}
            placeholder={inherited ? '— как по умолчанию —' : '— выберите модель —'}
            optionLabel={(m) => modelLabel(m, def.task, opSlug)}
            onChange={(modelId) => updateRoute(def.task, { modelId, usesDefault: false })}
          />
        </td>
        <td className="py-3 pr-4">
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            title={TEMPERATURE_HINT}
            aria-label={`Температура для ${def.label}`}
            className="w-[64px] h-[32px] px-2 rounded-[var(--radius-md)] border border-[var(--line)] disabled:opacity-50"
            value={inherited ? (defaultRoute?.temperature ?? route.temperature) : route.temperature}
            disabled={inherited}
            onChange={(e) => updateRoute(def.task, { temperature: Number(e.target.value), usesDefault: false })}
          />
        </td>
        <td className="py-3">
          <Button
            size="sm"
            onClick={() => saveRoute(def.task)}
            disabled={!!saving}
          >
            {saving === `route-${def.task}` ? '…' : 'Сохранить'}
          </Button>
        </td>
      </tr>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-[13px] text-[var(--ink-4)]">Загрузка конфигуратора ИИ…</div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-[15px] text-[var(--ink)]">{error}</p>
        <p className="text-[13px] text-[var(--ink-4)] mt-2">
          Установите isAdmin=true для пользователя в БД или запустите seed.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-[1100px] mx-auto p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-serif)' }}>
          Настройки ИИ
        </h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={importFromEnv} disabled={saving === 'import'}>
            Импорт из ENV
          </Button>
          <Button variant="secondary" onClick={load}>Обновить</Button>
        </div>
      </div>

      {usage && (
        <Card className="p-5">
          <h2 className="text-[15px] font-medium text-[var(--ink)] mb-3">Расходы за месяц</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-wide">Сумма</p>
              <p className="text-[22px] font-medium">{usage.totalCostRub.toFixed(2)} ₽</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-wide">Токены</p>
              <p className="text-[22px] font-medium">{usage.totalTokens.toLocaleString('ru')}</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--ink-4)] uppercase tracking-wide">Запросы</p>
              <p className="text-[22px] font-medium">{usage.requestCount}</p>
            </div>
          </div>
          {usage.byTask.length > 0 && (
            <div className="space-y-1">
              {usage.byTask.map((t) => {
                const label = taskDefs.find((d) => d.task === t.task)?.label ?? t.task
                return (
                  <div key={t.task} className="flex justify-between text-[12px] text-[var(--ink-3)]">
                    <span>{label}</span>
                    <span>{t.costRub.toFixed(2)} ₽ · {t.count} запр.</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-[15px] font-medium text-[var(--ink)]">Операторы</h2>
          <p className="text-[12px] text-[var(--ink-4)] mt-1">
            Ключи и URL — один раз. Карточки можно свернуть, основная работа в таблице маршрутов ниже.
          </p>
        </div>
        {operators.filter((o) => o.slug !== 'mock').map((op) => {
          const expanded = expandedOps[op.slug] === true
          return (
            <Card key={op.id} className="overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[var(--surface-inset)]/60 transition-colors"
                onClick={() => setExpandedOps((prev) => ({ ...prev, [op.slug]: !expanded }))}
                aria-expanded={expanded}
              >
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[var(--ink)]">{op.name}</p>
                  <p className="text-[12px] text-[var(--ink-4)] truncate">
                    {op.slug}
                    {' · '}
                    {op.isEnabled ? 'включён' : 'выключен'}
                    {' · '}
                    {op.hasCredentials ? 'ключ задан' : 'ключ не задан'}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label
                    className="flex items-center gap-2 text-[13px]"
                    title="Если выключен — этот оператор не используется в маршрутах"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={op.isEnabled}
                      onChange={(e) => setOperators((list) => list.map((o) => o.id === op.id ? { ...o, isEnabled: e.target.checked } : o))}
                    />
                    Включён
                  </label>
                  <span className="text-[var(--ink-4)] text-[14px]" aria-hidden>
                    {expanded ? '▾' : '▸'}
                  </span>
                </div>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--line)] pt-3">
                  {(OPERATOR_FIELDS[op.slug] ?? []).map((field) => (
                    <div key={field.key}>
                      <label className="text-[12px] text-[var(--ink-4)]">
                        {field.hint ? <HintLabel label={field.label} hint={field.hint} /> : field.label}
                      </label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        title={field.hint}
                        placeholder={op.credentialsMasked[field.key] || `Введите ${field.label}`}
                        className="w-full mt-1 h-[36px] px-3 rounded-[var(--radius-md)] border border-[var(--line)] text-[13px] bg-white"
                        value={credForms[op.slug]?.[field.key] ?? ''}
                        onChange={(e) => setCredForms((f) => ({
                          ...f,
                          [op.slug]: { ...f[op.slug], [field.key]: e.target.value },
                        }))}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button onClick={() => saveOperator(op.slug)} disabled={!!saving}>
                      {saving === `op-${op.slug}` ? 'Сохраняю…' : 'Сохранить'}
                    </Button>
                    <Button variant="secondary" onClick={() => testOperator(op.slug)} disabled={!!saving}>
                      Проверить
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <Card className="p-5 overflow-x-auto">
        <h2 className="text-[15px] font-medium text-[var(--ink)] mb-4">Маршрутизация задач</h2>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[var(--ink-4)] border-b border-[var(--line)]">
              <th className="pb-2 pr-4"><HintLabel label="Задача" hint={ROUTE_HEADER_HINTS.task} /></th>
              <th className="pb-2 pr-4"><HintLabel label="Оператор" hint={ROUTE_HEADER_HINTS.operator} /></th>
              <th className="pb-2 pr-4"><HintLabel label="Модель" hint={ROUTE_HEADER_HINTS.model} /></th>
              <th className="pb-2 pr-4"><HintLabel label="Температура" hint={ROUTE_HEADER_HINTS.temperature} /></th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {sortTaskDefs(taskDefs).map((def) => renderRouteRow(def))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
