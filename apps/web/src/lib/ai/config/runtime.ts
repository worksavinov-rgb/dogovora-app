import { AsyncLocalStorage } from 'async_hooks'
import type { AITask } from '../tasks'
import type { ResolvedAIRoute } from './types'

export interface UsageAccumulator {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costRub: number
}

interface AIRuntimeStore {
  routes: Map<AITask, ResolvedAIRoute>
  usage: UsageAccumulator
  primaryTask: AITask
}

const storage = new AsyncLocalStorage<AIRuntimeStore>()

function emptyUsage(): UsageAccumulator {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costRub: 0 }
}

function createStore(
  routes: Map<AITask, ResolvedAIRoute>,
  primaryTask: AITask = 'default',
): AIRuntimeStore {
  return { routes, usage: emptyUsage(), primaryTask }
}

/** Выполнить код с набором маршрутов (для подзадач review/spelling). */
export function withAIRoutes<T>(
  routes: Map<AITask, ResolvedAIRoute>,
  fn: () => T,
  primaryTask: AITask = 'default',
): T {
  return storage.run(createStore(routes, primaryTask), fn)
}

export async function withAIRoutesAsync<T>(
  routes: Map<AITask, ResolvedAIRoute>,
  fn: () => Promise<T>,
  primaryTask: AITask = 'default',
): Promise<T> {
  return storage.run(createStore(routes, primaryTask), fn)
}

/** Основная задача текущего вызова (edit / chat / review / …). */
export function getPrimaryTask(fallback: AITask = 'default'): AITask {
  return storage.getStore()?.primaryTask ?? fallback
}

/** Модель для текущей подзадачи внутри провайдера. */
export function getActiveRoute(task: AITask): ResolvedAIRoute | undefined {
  return storage.getStore()?.routes.get(task)
}

export function getActiveModelId(task: AITask, fallback: string): string {
  return getActiveRoute(task)?.modelId ?? fallback
}

export function getActiveTemperature(task: AITask, fallback: number): number {
  return getActiveRoute(task)?.temperature ?? fallback
}

export function getActiveMaxTokens(task: AITask, fallback?: number): number | undefined {
  const route = getActiveRoute(task)
  return route?.maxTokens ?? fallback
}

export function getActiveProviderPolicy(task: AITask) {
  return getActiveRoute(task)?.providerPolicy
}

export function getActivePolzaCredentials() {
  const routes = storage.getStore()?.routes
  if (!routes) return null
  for (const route of routes.values()) {
    if (route.operatorSlug === 'polza') return route.credentials
  }
  return null
}

export function getActiveGigachatCredentials() {
  const routes = storage.getStore()?.routes
  if (!routes) return null
  for (const route of routes.values()) {
    if (route.operatorSlug === 'gigachat') return route.credentials
  }
  return null
}

export function recordAIUsage(partial: {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costRub?: number
}): void {
  const store = storage.getStore()
  if (!store) return
  const prompt = partial.promptTokens ?? 0
  const completion = partial.completionTokens ?? 0
  const total = partial.totalTokens ?? prompt + completion
  store.usage.promptTokens += prompt
  store.usage.completionTokens += completion
  store.usage.totalTokens += total
  if (partial.costRub != null && Number.isFinite(partial.costRub)) {
    store.usage.costRub += partial.costRub
  }
}

export function getRecordedAIUsage(): UsageAccumulator {
  return storage.getStore()?.usage ?? emptyUsage()
}
