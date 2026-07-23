import { prisma } from '@/lib/db'
import type { AITask, OperatorSlug } from '../tasks'
import { AI_TASKS } from '../tasks'
import { decryptCredentials } from './encryption'
import { resolveRouteFromEnv } from './env-fallback'
import type {
  GigachatCredentials,
  MockCredentials,
  OpenAICompatibleCredentials,
  OperatorCredentials,
  PolzaCredentials,
  ProviderPolicy,
  ResolvedAIRoute,
} from './types'

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  routes: Map<AITask, ResolvedAIRoute>
  operators: Map<string, { slug: OperatorSlug; credentials: OperatorCredentials }>
  expiresAt: number
}

let cache: CacheEntry | null = null

function parseProviderPolicy(raw: string | null | undefined): ProviderPolicy | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as ProviderPolicy
  } catch {
    return undefined
  }
}

function credentialsForSlug(slug: OperatorSlug, encrypted: string): OperatorCredentials {
  const data = decryptCredentials<Record<string, string>>(encrypted)
  if (slug === 'polza') {
    return {
      apiKey: data.apiKey ?? '',
      baseUrl: data.baseUrl ?? 'https://polza.ai/api/v1',
    } satisfies PolzaCredentials
  }
  if (slug === 'openrouter') {
    return {
      apiKey: data.apiKey ?? '',
      baseUrl: data.baseUrl ?? 'https://openrouter.ai/api/v1',
    } satisfies OpenAICompatibleCredentials
  }
  if (slug === 'gigachat') {
    return {
      authKey: data.authKey ?? '',
      scope: data.scope ?? 'GIGACHAT_API_PERS',
      baseUrl: data.baseUrl ?? 'https://gigachat.devices.sberbank.ru/api/v1',
      authUrl: data.authUrl ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    } satisfies GigachatCredentials
  }
  return {} satisfies MockCredentials
}

async function loadFromDb(): Promise<CacheEntry | null> {
  const operators = await prisma.aIOperator.findMany({ where: { isEnabled: true } })
  if (operators.length === 0) return null

  const routes = await prisma.aITaskRoute.findMany({
    where: { isEnabled: true },
    include: { operator: true },
  })

  const operatorMap = new Map<string, { slug: OperatorSlug; credentials: OperatorCredentials }>()
  for (const op of operators) {
    operatorMap.set(op.id, {
      slug: op.slug as OperatorSlug,
      credentials: credentialsForSlug(op.slug as OperatorSlug, op.credentials),
    })
  }

  const routeMap = new Map<AITask, ResolvedAIRoute>()
  for (const route of routes) {
    const op = operatorMap.get(route.operatorId)
    if (!op) continue
    routeMap.set(route.task as AITask, {
      task: route.task as AITask,
      operatorSlug: op.slug,
      operatorId: route.operatorId,
      modelId: route.modelId,
      temperature: route.temperature,
      maxTokens: route.maxTokens ?? undefined,
      providerPolicy: parseProviderPolicy(route.providerPolicy),
      credentials: op.credentials,
    })
  }

  return {
    routes: routeMap,
    operators: operatorMap,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
}

async function getCache(): Promise<CacheEntry | null> {
  if (cache && cache.expiresAt > Date.now()) return cache
  cache = await loadFromDb()
  return cache
}

/** Сбросить кеш после изменений в админке. */
export function invalidateAIConfigCache(): void {
  cache = null
}

/** Получить маршрут для задачи: БД → default в БД → ENV. */
export async function resolveAIRoute(task: AITask): Promise<ResolvedAIRoute> {
  const db = await getCache()
  if (db) {
    const specific = db.routes.get(task)
    if (specific) return specific
    const fallback = db.routes.get('default')
    if (fallback) return { ...fallback, task }
  }
  return resolveRouteFromEnv(task)
}

/** Все маршруты для runtime-контекста (review использует несколько подзадач). */
export async function resolveAllRoutes(primaryTask: AITask): Promise<Map<AITask, ResolvedAIRoute>> {
  const map = new Map<AITask, ResolvedAIRoute>()
  for (const task of AI_TASKS) {
    map.set(task, await resolveAIRoute(task))
  }
  // Для основной задачи гарантируем маршрут именно для неё
  map.set(primaryTask, await resolveAIRoute(primaryTask))
  return map
}

/** Есть ли конфигурация в БД (для UI: показывать «из ENV» или «из админки»). */
export async function hasDbAIConfig(): Promise<boolean> {
  const count = await prisma.aIOperator.count()
  return count > 0
}
