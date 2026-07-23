import type { AITask, OperatorSlug } from '../tasks'

/** OpenAI-совместимый оператор (Polza, OpenRouter и т.п.) */
export interface OpenAICompatibleCredentials {
  apiKey: string
  baseUrl?: string
}

export type PolzaCredentials = OpenAICompatibleCredentials
export type OpenRouterCredentials = OpenAICompatibleCredentials

export interface GigachatCredentials {
  authKey: string
  scope?: string
  baseUrl?: string
  authUrl?: string
}

export interface MockCredentials {
  /** mock не требует ключей */
}

export type OperatorCredentials =
  | PolzaCredentials
  | OpenRouterCredentials
  | GigachatCredentials
  | MockCredentials

export interface ProviderPolicy {
  sort?: 'price' | 'latency' | 'throughput'
  only?: string[]
  ignore?: string[]
  allow_fallbacks?: boolean
  max_price?: {
    prompt?: number
    completion?: number
  }
}

export interface ResolvedAIRoute {
  task: AITask
  operatorSlug: OperatorSlug
  operatorId?: string
  modelId: string
  temperature: number
  maxTokens?: number
  providerPolicy?: ProviderPolicy
  credentials: OperatorCredentials
}

export interface AIUsageMeta {
  task: AITask
  userId?: string
  versionId?: string
}

export interface AIUsageResult {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costRub?: number
  durationMs: number
  modelId: string
  operatorSlug: OperatorSlug
  operatorId?: string
}
