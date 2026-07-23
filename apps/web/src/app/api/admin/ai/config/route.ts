import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { encryptCredentials, decryptCredentials, maskSecret } from '@/lib/ai/config/encryption'
import { invalidateAIConfigCache, hasDbAIConfig } from '@/lib/ai/config/service'
import { exportEnvConfig } from '@/lib/ai/config/env-fallback'
import { AI_TASK_DEFINITIONS, OPERATOR_CATALOG } from '@/lib/ai/tasks'
import { getGigachatChatModels } from '@/lib/ai/gigachat-models'
import {
  openrouterListModels,
  openrouterVerify,
  polzaGetBalance,
  polzaListModels,
} from '@/lib/ai/openai-compatible'

function mergeOperatorsForDisplay(
  dbOperators: Array<{
    id: string
    slug: string
    name: string
    isEnabled: boolean
    credentials: string
  }>,
  envSlug: string,
) {
  const bySlug = new Map(dbOperators.map((o) => [o.slug, o]))
  return OPERATOR_CATALOG.map((cat) => {
    const existing = bySlug.get(cat.slug)
    if (existing) return existing
    return {
      id: `env-${cat.slug}`,
      slug: cat.slug,
      name: cat.name,
      isEnabled: envSlug === cat.slug,
      credentials: '',
    }
  })
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const operators = await prisma.aIOperator.findMany({ orderBy: { slug: 'asc' } })
  const routes = await prisma.aITaskRoute.findMany({ include: { operator: true }, orderBy: { task: 'asc' } })

  const envFallback = exportEnvConfig()
  const displayOperators = mergeOperatorsForDisplay(operators, envFallback.operator.slug)

  const gigachatOp = displayOperators.find((o) => o.slug === 'gigachat')
  const gigachatCreds = gigachatOp?.credentials
    ? decryptCredentials<Record<string, string>>(gigachatOp.credentials)
    : envFallback.operator.slug === 'gigachat'
      ? (envFallback.operator.credentials as Record<string, string>)
      : {}
  const gigachatAuthKey = gigachatCreds.authKey ?? process.env['GIGACHAT_AUTH_KEY'] ?? ''
  const gigachatModelsResult = await getGigachatChatModels(
    gigachatAuthKey
      ? {
          authKey: gigachatAuthKey,
          scope: gigachatCreds.scope ?? process.env['GIGACHAT_SCOPE'],
          baseUrl: gigachatCreds.baseUrl ?? process.env['GIGACHAT_BASE_URL'],
          authUrl: gigachatCreds.authUrl ?? process.env['GIGACHAT_AUTH_URL'],
        }
      : undefined,
  )

  return NextResponse.json({
    source: (await hasDbAIConfig()) ? 'database' : 'env',
    taskDefinitions: AI_TASK_DEFINITIONS,
    gigachatModels: gigachatModelsResult.models,
    operators: displayOperators.map((op) => {
      const creds = op.credentials
        ? decryptCredentials<Record<string, string>>(op.credentials)
        : (envFallback.operator.slug === op.slug
          ? envFallback.operator.credentials as Record<string, string>
          : {})
      const masked: Record<string, string> = {}
      for (const [k, v] of Object.entries(creds)) {
        masked[k] = k.toLowerCase().includes('key') || k.toLowerCase().includes('secret') ? maskSecret(String(v)) : String(v ?? '')
      }
      return {
        id: op.id,
        slug: op.slug,
        name: op.name,
        isEnabled: op.isEnabled,
        credentialsMasked: masked,
        hasCredentials: Object.values(creds).some((v) => v && String(v).length > 0),
      }
    }),
    routes: routes.map((r) => ({
      task: r.task,
      operatorId: r.operatorId,
      operatorSlug: r.operator.slug,
      modelId: r.modelId,
      temperature: r.temperature,
      maxTokens: r.maxTokens,
      providerPolicy: r.providerPolicy
        ? (typeof r.providerPolicy === 'string' ? JSON.parse(r.providerPolicy) : r.providerPolicy)
        : null,
      isEnabled: r.isEnabled,
    })),
  })
}

const operatorSchema = z.object({
  slug: z.enum(['polza', 'gigachat', 'openrouter', 'mock']),
  name: z.string().min(1),
  isEnabled: z.boolean(),
  credentials: z.record(z.string(), z.string()).optional(),
})

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = operatorSchema.parse(await req.json())
  const existing = await prisma.aIOperator.findUnique({ where: { slug: body.slug } })
  const prevCreds = existing ? decryptCredentials<Record<string, string>>(existing.credentials) : {}
  const merged = { ...prevCreds, ...body.credentials }

  const operator = await prisma.aIOperator.upsert({
    where: { slug: body.slug },
    update: {
      name: body.name,
      isEnabled: body.isEnabled,
      credentials: encryptCredentials(merged),
    },
    create: {
      slug: body.slug,
      name: body.name,
      isEnabled: body.isEnabled,
      credentials: encryptCredentials(merged),
    },
  })

  invalidateAIConfigCache()
  return NextResponse.json({ id: operator.id, slug: operator.slug })
}

const OPERATOR_NAMES: Record<string, string> = {
  polza: 'Polza.ai',
  gigachat: 'GigaChat',
  openrouter: 'OpenRouter',
  mock: 'Mock',
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { action?: string; slug?: string }
  const { action, slug } = body

  if (action === 'import-env') {
    const env = exportEnvConfig()
    const slug = env.operator.slug
    const operator = await prisma.aIOperator.upsert({
      where: { slug },
      update: {
        credentials: encryptCredentials(env.operator.credentials as Record<string, unknown>),
        isEnabled: true,
      },
      create: {
        slug,
        name: OPERATOR_NAMES[slug] ?? slug,
        credentials: encryptCredentials(env.operator.credentials as Record<string, unknown>),
        isEnabled: slug !== 'mock',
      },
    })
    for (const r of env.routes) {
      await prisma.aITaskRoute.upsert({
        where: { task: r.task },
        update: { operatorId: operator.id, modelId: r.modelId, temperature: r.temperature },
        create: { task: r.task, operatorId: operator.id, modelId: r.modelId, temperature: r.temperature },
      })
    }
    invalidateAIConfigCache()
    return NextResponse.json({ ok: true })
  }

  if (action === 'test-operator') {
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
    const op = await prisma.aIOperator.findUnique({ where: { slug } })
    if (!op) return NextResponse.json({ error: 'Сначала сохраните оператора' }, { status: 404 })
    const creds = decryptCredentials<Record<string, string>>(op.credentials)
    try {
      if (slug === 'polza') {
        const balance = await polzaGetBalance(creds.apiKey ?? '')
        return NextResponse.json({ ok: true, balance: balance.amount })
      }
      if (slug === 'openrouter') {
        await openrouterVerify(creds.apiKey ?? '', creds.baseUrl)
        return NextResponse.json({ ok: true, message: 'Ключ OpenRouter принят' })
      }
      if (slug === 'gigachat') {
        if (!creds.authKey) throw new Error('authKey не задан')
        return NextResponse.json({ ok: true, message: 'Ключ задан' })
      }
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Ошибка проверки' },
        { status: 400 },
      )
    }
  }

  if (action === 'list-models') {
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
    if (slug === 'gigachat') {
      const op = await prisma.aIOperator.findUnique({ where: { slug: 'gigachat' } })
      const creds = op ? decryptCredentials<Record<string, string>>(op.credentials) : {}
      const authKey = creds.authKey ?? process.env['GIGACHAT_AUTH_KEY'] ?? ''
      const result = await getGigachatChatModels(
        authKey
          ? {
              authKey,
              scope: creds.scope ?? process.env['GIGACHAT_SCOPE'],
              baseUrl: creds.baseUrl ?? process.env['GIGACHAT_BASE_URL'],
              authUrl: creds.authUrl ?? process.env['GIGACHAT_AUTH_URL'],
            }
          : undefined,
      )
      return NextResponse.json({ models: result.models, source: result.source })
    }
    if (slug === 'openrouter') {
      const op = await prisma.aIOperator.findUnique({ where: { slug: 'openrouter' } })
      const creds = op ? decryptCredentials<Record<string, string>>(op.credentials) : {}
      const apiKey = creds.apiKey ?? process.env['OPENROUTER_API_KEY'] ?? ''
      if (!apiKey) return NextResponse.json({ models: [] })
      const models = await openrouterListModels(apiKey, creds.baseUrl)
      return NextResponse.json({
        models: models.map((m) => ({ id: m.id, name: m.name ?? m.id })),
      })
    }
    if (slug === 'polza') {
      const op = await prisma.aIOperator.findUnique({ where: { slug: 'polza' } })
      const creds = op ? decryptCredentials<Record<string, string>>(op.credentials) : {}
      const apiKey = creds.apiKey ?? process.env['POLZA_API_KEY'] ?? ''
      if (!apiKey) return NextResponse.json({ models: [] })
      const models = await polzaListModels(apiKey) as Array<{ id: string; name?: string }>
      return NextResponse.json({
        models: models.map((m) => ({ id: m.id, name: m.name ?? m.id })),
      })
    }
    return NextResponse.json({ models: [] })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
