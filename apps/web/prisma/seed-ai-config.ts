/**
 * Импорт конфигурации ИИ из ENV в БД.
 * Запуск: pnpm --filter web exec tsx prisma/seed-ai-config.ts
 */
import { PrismaClient } from '@prisma/client'
import { encryptCredentials } from '../src/lib/ai/config/encryption'
import { exportEnvConfig } from '../src/lib/ai/config/env-fallback'
import { AI_TASK_DEFINITIONS, OPERATOR_CATALOG } from '../src/lib/ai/tasks'

const prisma = new PrismaClient()

function credentialsFromEnv(slug: string): Record<string, string> {
  if (slug === 'polza') {
    return {
      apiKey: process.env['POLZA_API_KEY'] ?? '',
      baseUrl: process.env['POLZA_BASE_URL'] ?? 'https://polza.ai/api/v1',
    }
  }
  if (slug === 'openrouter') {
    return {
      apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
      baseUrl: process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1',
    }
  }
  if (slug === 'gigachat') {
    return {
      authKey: process.env['GIGACHAT_AUTH_KEY'] ?? '',
      scope: process.env['GIGACHAT_SCOPE'] ?? 'GIGACHAT_API_PERS',
      baseUrl: process.env['GIGACHAT_BASE_URL'] ?? 'https://gigachat.devices.sberbank.ru/api/v1',
      authUrl: process.env['GIGACHAT_AUTH_URL'] ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    }
  }
  return {}
}

async function main() {
  const env = exportEnvConfig()
  const slug = env.operator.slug

  const operatorNames: Record<string, string> = {
    polza: 'Polza.ai',
    gigachat: 'GigaChat',
    openrouter: 'OpenRouter',
    mock: 'Mock (dev)',
  }

  const operator = await prisma.aIOperator.upsert({
    where: { slug },
    update: {
      name: operatorNames[slug] ?? slug,
      credentials: encryptCredentials(env.operator.credentials as Record<string, unknown>),
      isEnabled: slug !== 'mock',
    },
    create: {
      slug,
      name: operatorNames[slug] ?? slug,
      credentials: encryptCredentials(env.operator.credentials as Record<string, unknown>),
      isEnabled: slug !== 'mock',
    },
  })

  // Дополнительные операторы (выключены, для настройки в админке)
  for (const cat of OPERATOR_CATALOG) {
    if (cat.slug === slug) continue
    await prisma.aIOperator.upsert({
      where: { slug: cat.slug },
      update: {},
      create: {
        slug: cat.slug,
        name: cat.name,
        credentials: encryptCredentials(credentialsFromEnv(cat.slug)),
        isEnabled: false,
      },
    })
  }

  for (const def of AI_TASK_DEFINITIONS) {
    const routeEnv = env.routes.find((r) => r.task === def.task)
    await prisma.aITaskRoute.upsert({
      where: { task: def.task },
      update: {},
      create: {
        task: def.task,
        operatorId: operator.id,
        modelId: routeEnv?.modelId ?? 'openai/gpt-4o-mini',
        temperature: routeEnv?.temperature ?? 0.7,
      },
    })
  }

  console.log(`AI config seeded. Primary operator: ${slug}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
