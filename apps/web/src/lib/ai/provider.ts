import type { AIProvider } from './types'
import type { AITask } from './tasks'
import { mockProvider } from './mock-provider'
import { gigachatProvider } from './gigachat-provider'
import { resolveAIRoute, resolveAllRoutes } from './config/service'
import { getRecordedAIUsage, withAIRoutes, withAIRoutesAsync } from './config/runtime'
import type { AIUsageMeta, AIUsageResult } from './config/types'
import { logAIUsage } from './config/usage-logger'
import type { UsageAccumulator } from './config/runtime'

function pickProvider(operatorSlug: string): AIProvider {
  if (operatorSlug === 'mock') return mockProvider
  // polza и gigachat идут через один provider — транспорт выбирает оператора по маршруту
  return gigachatProvider
}

/** @deprecated Используйте runWithAI(task, meta, fn) */
export function getAIProvider(): AIProvider {
  const provider = (process.env['AI_PROVIDER'] ?? 'mock').toLowerCase()
  if (provider === 'gigachat' || provider === 'polza') return gigachatProvider
  return mockProvider
}

function toUsageResult(
  route: Awaited<ReturnType<typeof resolveAIRoute>>,
  started: number,
  usage: UsageAccumulator,
): AIUsageResult {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    costRub: usage.costRub > 0 ? usage.costRub : undefined,
    durationMs: Date.now() - started,
    modelId: route.modelId,
    operatorSlug: route.operatorSlug,
    operatorId: route.operatorId,
  }
}

export async function runWithAI<T>(
  task: AITask,
  meta: Omit<AIUsageMeta, 'task'>,
  fn: (provider: AIProvider) => Promise<T>,
): Promise<T> {
  const route = await resolveAIRoute(task)
  const routes = await resolveAllRoutes(task)
  const provider = pickProvider(route.operatorSlug)
  const started = Date.now()

  return withAIRoutesAsync(routes, async () => {
    const result = await fn(provider)
    void logAIUsage({ task, ...meta }, toUsageResult(route, started, getRecordedAIUsage()))
    return result
  }, task)
}

export async function getAIContext(task: AITask) {
  const route = await resolveAIRoute(task)
  const routes = await resolveAllRoutes(task)
  const provider = pickProvider(route.operatorSlug)
  return { route, routes, provider }
}

/**
 * Выполняет fn в AI-контексте и пишет usage-лог.
 * Используйте вместо пары withAIContextAsync + logContextUsage.
 */
export async function withLoggedAIContext<T>(
  task: AITask,
  meta: Omit<AIUsageMeta, 'task'>,
  fn: (ctx: {
    provider: AIProvider
    route: Awaited<ReturnType<typeof resolveAIRoute>>
  }) => Promise<T>,
): Promise<T> {
  const route = await resolveAIRoute(task)
  const routes = await resolveAllRoutes(task)
  const provider = pickProvider(route.operatorSlug)
  const started = Date.now()

  return withAIRoutesAsync(routes, async () => {
    const result = await fn({ provider, route })
    void logAIUsage({ task, ...meta }, toUsageResult(route, started, getRecordedAIUsage()))
    return result
  }, task)
}

export function withAIContext<T>(
  routes: Awaited<ReturnType<typeof resolveAllRoutes>>,
  fn: () => T,
): T {
  return withAIRoutes(routes, fn)
}

export async function withAIContextAsync<T>(
  routes: Awaited<ReturnType<typeof resolveAllRoutes>>,
  fn: () => Promise<T>,
): Promise<T> {
  return withAIRoutesAsync(routes, fn)
}
