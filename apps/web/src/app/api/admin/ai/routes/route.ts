import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { invalidateAIConfigCache } from '@/lib/ai/config/service'
import { AI_TASKS } from '@/lib/ai/tasks'

const routeSchema = z.object({
  task: z.enum(AI_TASKS),
  useDefault: z.boolean().optional(),
  operatorId: z.string().optional(),
  modelId: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().nullable().optional(),
  providerPolicy: z.record(z.string(), z.unknown()).nullable().optional(),
  isEnabled: z.boolean().default(true),
})

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = routeSchema.parse(await req.json())

  if (body.task !== 'default' && body.useDefault) {
    await prisma.aITaskRoute.deleteMany({ where: { task: body.task } })
    invalidateAIConfigCache()
    return NextResponse.json({ ok: true, task: body.task, useDefault: true })
  }

  if (!body.operatorId || !body.modelId) {
    return NextResponse.json(
      { error: body.task === 'default' ? 'Укажите оператор и модель для маршрута по умолчанию' : 'Укажите оператор и модель' },
      { status: 400 },
    )
  }

  const operator = await prisma.aIOperator.findUnique({ where: { id: body.operatorId } })
  if (!operator) return NextResponse.json({ error: 'Operator not found' }, { status: 404 })

  const route = await prisma.aITaskRoute.upsert({
    where: { task: body.task },
    update: {
      operatorId: body.operatorId,
      modelId: body.modelId,
      temperature: body.temperature,
      maxTokens: body.maxTokens ?? null,
      providerPolicy: body.providerPolicy ? JSON.stringify(body.providerPolicy) : null,
      isEnabled: body.isEnabled,
    },
    create: {
      task: body.task,
      operatorId: body.operatorId,
      modelId: body.modelId,
      temperature: body.temperature,
      maxTokens: body.maxTokens ?? null,
      providerPolicy: body.providerPolicy ? JSON.stringify(body.providerPolicy) : null,
      isEnabled: body.isEnabled,
    },
  })

  invalidateAIConfigCache()
  return NextResponse.json(route)
}
