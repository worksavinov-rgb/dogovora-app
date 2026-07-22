/**
 * Импорт конфигурации ИИ из ENV в БД.
 * Запуск: pnpm --filter web exec tsx prisma/seed-ai-config.ts
 */
import { PrismaClient } from '@prisma/client'
import { encryptCredentials } from '../src/lib/ai/config/encryption'
import { exportEnvConfig } from '../src/lib/ai/config/env-fallback'
import { AI_TASK_DEFINITIONS } from '../src/lib/ai/tasks'

const prisma = new PrismaClient()

async function main() {
  const env = exportEnvConfig()
  const slug = env.operator.slug

  const operatorNames: Record<string, string> = {
    polza: 'Polza.ai',
    gigachat: 'GigaChat',
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
  for (const extra of ['polza', 'gigachat'] as const) {
    if (extra === slug) continue
    const creds =
      extra === 'polza'
        ? { apiKey: process.env['POLZA_API_KEY'] ?? '', baseUrl: 'https://polza.ai/api/v1' }
        : {
            authKey: process.env['GIGACHAT_AUTH_KEY'] ?? '',
            scope: process.env['GIGACHAT_SCOPE'] ?? 'GIGACHAT_API_PERS',
          }
    await prisma.aIOperator.upsert({
      where: { slug: extra },
      update: {},
      create: {
        slug: extra,
        name: operatorNames[extra],
        credentials: encryptCredentials(creds),
        isEnabled: false,
      },
    })
  }

  for (const def of AI_TASK_DEFINITIONS) {
    const routeEnv = env.routes.find((r) => r.task === def.task)
    if (!routeEnv) continue
    await prisma.aITaskRoute.upsert({
      where: { task: def.task },
      update: {
        operatorId: operator.id,
        modelId: routeEnv.modelId,
        temperature: routeEnv.temperature,
      },
      create: {
        task: def.task,
        operatorId: operator.id,
        modelId: routeEnv.modelId,
        temperature: routeEnv.temperature,
      },
    })
  }

  console.log(`AI config seeded: operator=${slug}, routes=${env.routes.length}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
