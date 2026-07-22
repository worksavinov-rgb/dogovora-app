import type { AITask } from '../tasks'
import type { GigachatCredentials, PolzaCredentials, ResolvedAIRoute } from './types'

function envProvider(): 'polza' | 'gigachat' | 'mock' {
  const p = (process.env['AI_PROVIDER'] ?? 'mock').toLowerCase()
  if (p === 'polza') return 'polza'
  if (p === 'gigachat') return 'gigachat'
  return 'mock'
}

function envModelForTask(task: AITask): string {
  const key = `AI_MODEL_${task.toUpperCase()}`
  const specific = process.env[key]
  if (specific) return specific

  if (task === 'review' || task === 'review_fallback' || task === 'analyze_upload' || task === 'quick_analysis') {
    return process.env['GIGACHAT_REVIEW_MODEL'] ?? process.env['AI_MODEL_REVIEW'] ?? 'GigaChat-2-Max'
  }
  if (task === 'spelling' || task === 'extract_parties') {
    return process.env['GIGACHAT_FAST_MODEL'] ?? process.env['AI_MODEL_SPELLING'] ?? 'GigaChat-2'
  }

  if (envProvider() === 'polza') {
    return process.env['AI_MODEL_DEFAULT'] ?? 'openai/gpt-4o-mini'
  }
  return process.env['GIGACHAT_MODEL'] ?? process.env['AI_MODEL_DEFAULT'] ?? 'GigaChat-2-Max'
}

function polzaCredentialsFromEnv(): PolzaCredentials {
  return {
    apiKey: process.env['POLZA_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '',
    baseUrl: process.env['POLZA_BASE_URL'] ?? 'https://polza.ai/api/v1',
  }
}

function gigachatCredentialsFromEnv(): GigachatCredentials {
  return {
    authKey: process.env['GIGACHAT_AUTH_KEY'] ?? '',
    scope: process.env['GIGACHAT_SCOPE'] ?? 'GIGACHAT_API_PERS',
    baseUrl: process.env['GIGACHAT_BASE_URL'] ?? 'https://gigachat.devices.sberbank.ru/api/v1',
    authUrl: process.env['GIGACHAT_AUTH_URL'] ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
  }
}

/** Маршрут из ENV — используется если в БД нет настроек. */
export function resolveRouteFromEnv(task: AITask): ResolvedAIRoute {
  const slug = envProvider()
  const credentials =
    slug === 'polza'
      ? polzaCredentialsFromEnv()
      : slug === 'gigachat'
        ? gigachatCredentialsFromEnv()
        : {}

  return {
    task,
    operatorSlug: slug,
    modelId: envModelForTask(task),
    temperature: 0.7,
    credentials,
  }
}

/** Снимок ENV для импорта в админку. */
export function exportEnvConfig() {
  const slug = envProvider()
  return {
    operator: {
      slug,
      credentials:
        slug === 'polza'
          ? polzaCredentialsFromEnv()
          : slug === 'gigachat'
            ? gigachatCredentialsFromEnv()
            : {},
    },
    routes: (['default', 'generate', 'edit', 'chat', 'quick_analysis', 'review', 'analyze_upload', 'spelling', 'review_fallback', 'extract_parties'] as AITask[]).map(
      (task) => ({
        task,
        modelId: envModelForTask(task),
        temperature: task === 'edit' ? 0.25 : (task === 'review' || task === 'analyze_upload') ? 0.1 : 0.7,
      }),
    ),
  }
}
